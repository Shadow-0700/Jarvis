import { LlmClient, ChatCompletionMessage } from './LlmClient';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PromptBuilder } from './PromptBuilder';
import { ModelRouter } from './ModelRouter';
import { StorageManager } from '../cache/StorageManager';
import { 
  ActivityItem, 
  AgentStatus, 
  ChatMessage, 
  DiffItem, 
  ExecutionMode, 
  PendingApproval 
} from '../types/agent';
import { ToolCall } from '../types/tools';

export interface AgentLoopEvents {
  onStatusChange: (status: AgentStatus) => void;
  onThoughtChunk: (chunk: string, isComplete?: boolean) => void;
  onContentChunk: (chunk: string) => void;
  onActivityUpdate: (activity: ActivityItem) => void;
  onDiffUpdate: (diff: DiffItem) => void;
  onRequestApproval: (approval: PendingApproval) => Promise<boolean>;
  onComplete: (message: ChatMessage) => void;
  onError: (error: string) => void;
}

export class AgentLoop {
  private _messages: ChatCompletionMessage[] = [];
  private _currentActivities: ActivityItem[] = [];
  private _currentDiffs: DiffItem[] = [];
  private _abortController: AbortController | null = null;
  private _toolRegistry: ToolRegistry;
  private _modelRouter: ModelRouter = new ModelRouter();

  constructor(
    private readonly _events: AgentLoopEvents,
    private readonly _mode: ExecutionMode = 'turbo'
  ) {
    this._toolRegistry = new ToolRegistry({
      onDiffGenerated: (diff) => {
        this._currentDiffs.push(diff);
        this._events.onDiffUpdate(diff);
      }
    });

    this.resetConversation();
  }

  public resetConversation() {
    this._messages = [
      {
        role: 'system',
        content: PromptBuilder.buildSystemPrompt()
      }
    ];
  }

  public cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._events.onStatusChange('cancelled');
  }

  public async runTask(
    userPrompt: string,
    modelId: string,
    apiKey: string,
    mode: ExecutionMode,
    baseUrl?: string
  ): Promise<void> {
    this._abortController = new AbortController();
    const client = new LlmClient(apiKey, baseUrl);
    const tools = this._toolRegistry.getToolDefinitions();

    this._currentActivities = [];
    this._currentDiffs = [];

    // Append user input
    this._messages.push({
      role: 'user',
      content: userPrompt
    });

    let currentTurn = 0;
    let groqRetryCount = 0;
    const MAX_TURNS = 15;
    let accumulatedThought = '';
    let accumulatedContent = '';
    const startTime = Date.now();

    this._events.onStatusChange('reasoning');

    let effectiveModel = modelId;

    // If no model was selected, default to active free model
    if (!effectiveModel) {
      effectiveModel = 'meta-llama/llama-3.3-70b-instruct:free';
    }

    try {
      while (currentTurn < MAX_TURNS) {
        if (this._abortController?.signal.aborted) {
          throw new Error('Task was cancelled by user.');
        }

        currentTurn++;

        let turnThought = '';
        let turnContent = '';

        const isGroq = baseUrl?.includes('groq.com');
        const prunedMessages = this._pruneMessagesForProvider(this._messages, Boolean(isGroq));

        let response;
        try {
          response = await client.complete(
            effectiveModel,
            prunedMessages,
            tools,
            {
              onReasoningChunk: (chunk) => {
                turnThought += chunk;
                accumulatedThought += chunk;
                this._events.onThoughtChunk(chunk, false);
              },
              onContentChunk: (chunk) => {
                turnContent += chunk;
                accumulatedContent += chunk;
                this._events.onContentChunk(chunk);
              }
            },
            this._abortController.signal
          );
        } catch (apiErr: any) {
          const errMsg = String(apiErr);
          const isNvidia = baseUrl?.includes('nvidia.com');
          const isOpenRouter = !baseUrl || baseUrl.includes('openrouter.ai');

          if (
            errMsg.includes('429') ||
            errMsg.includes('rate limit') ||
            errMsg.includes('unavailable') ||
            errMsg.includes('404') ||
            errMsg.includes('410') ||
            errMsg.includes('Gone') ||
            errMsg.includes('ECONNRESET') ||
            errMsg.includes('timed out') ||
            errMsg.includes('timeout') ||
            errMsg.includes('ResourceExhausted') ||
            errMsg.includes('Not found') ||
            errMsg.includes('413') ||
            errMsg.includes('Request too large') ||
            errMsg.includes('ITPM') ||
            errMsg.includes('No endpoints found')
          ) {
            if (isGroq && (errMsg.includes('413') || errMsg.includes('Request too large') || errMsg.includes('ITPM') || errMsg.includes('429'))) {
              groqRetryCount++;
              if (groqRetryCount > 1) {
                throw new Error(
                  `Groq free tier limit exceeded (7,000 tokens/min cap). Switch to 'Nemotron 3.5 Lightning (NVIDIA)' in the bottom model picker for 128k context and unlimited coding tokens.`
                );
              }

              this._events.onActivityUpdate({
                id: `prune_${Date.now()}`,
                timestamp: Date.now(),
                type: 'plan',
                title: `Groq 7k limit reached: Retrying with minimal payload...`,
                status: 'success'
              });

              for (const m of this._messages) {
                if (m.role === 'tool' && m.content && m.content.length > 250) {
                  m.content = m.content.slice(0, 250) + '... [truncated]';
                }
              }

              await new Promise(r => setTimeout(r, 2000));
              continue;
            }

            if (isNvidia) {
              const nextNvidiaModel = effectiveModel !== 'nvidia/nemotron-3.5-lightning-30b-a3b' 
                ? 'nvidia/nemotron-3.5-lightning-30b-a3b' 
                : 'nvidia/nemotron-3-ultra-550b-a55b';
              
              if (effectiveModel !== nextNvidiaModel) {
                this._events.onActivityUpdate({
                  id: `fallback_${Date.now()}`,
                  timestamp: Date.now(),
                  type: 'plan',
                  title: `Model ${effectiveModel} failed on NVIDIA (${errMsg.slice(0, 40)}...): Auto-switching to ${nextNvidiaModel}`,
                  status: 'success'
                });
                effectiveModel = nextNvidiaModel;
                continue;
              }
            } else if (isOpenRouter && effectiveModel !== 'openrouter/free') {
              this._events.onActivityUpdate({
                id: `fallback_${Date.now()}`,
                timestamp: Date.now(),
                type: 'plan',
                title: `Model was unavailable on OpenRouter: Auto-routed to openrouter/free`,
                status: 'success'
              });
              effectiveModel = 'openrouter/free';
              continue;
            }
          }
          throw apiErr;
        }

        if (turnThought) {
          this._events.onThoughtChunk('', true); // Mark thought stream as complete
        }

        // If no tool calls were requested, the agent has finished its work
        if (!response.toolCalls || response.toolCalls.length === 0) {
          this._messages.push({
            role: 'assistant',
            content: response.content
          });
          break;
        }

        // Record assistant response with tool calls
        this._messages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        });

        this._events.onStatusChange('executing_tool');

        // Execute each tool sequentially
        for (const toolCall of response.toolCalls) {
          if (this._abortController?.signal.aborted) {
            throw new Error('Task was cancelled by user.');
          }

          const activityId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const activity: ActivityItem = {
            id: activityId,
            timestamp: Date.now(),
            type: this._mapToolToActivityType(toolCall.name),
            title: this._formatActivityTitle(toolCall),
            status: 'running'
          };

          this._currentActivities.push(activity);
          this._events.onActivityUpdate(activity);

          // Safety check & Approval verification
          const isDangerous = this._isDangerousAction(toolCall, mode);
          if (isDangerous) {
            this._events.onStatusChange('awaiting_approval');
            const approved = await this._events.onRequestApproval({
              id: activityId,
              actionType: toolCall.name === 'run_command' ? 'command' : 'delete_file',
              description: `Confirm execution of ${toolCall.name}`,
              commandOrPath: toolCall.arguments.command || toolCall.arguments.filePath
            });

            if (!approved) {
              activity.status = 'skipped';
              activity.detail = 'Action rejected by user.';
              this._events.onActivityUpdate(activity);

              this._messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: 'Execution cancelled: The user denied permission to execute this action.'
              });
              continue;
            }
            this._events.onStatusChange('executing_tool');
          }

          // Execute tool
          const actStart = Date.now();
          const result = await this._toolRegistry.executeTool(toolCall);
          activity.durationMs = Date.now() - actStart;

          if (result.success) {
            activity.status = 'success';
            activity.output = result.output;
          } else {
            activity.status = 'failed';
            activity.output = result.error || 'Operation failed';
            this._events.onStatusChange('diagnosing');
          }

          this._events.onActivityUpdate(activity);

          // Return tool result to conversation history
          this._messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.success ? (result.output || 'Success') : `Error: ${result.error}`
          });
        }

        this._events.onStatusChange('reasoning');
      }

      if (!accumulatedContent && !accumulatedThought && this._currentActivities.length === 0) {
        throw new Error('No response was generated by the model. Please check your provider quota or switch to Nemotron 3.5 Lightning (NVIDIA).');
      }

      this._events.onStatusChange('completed');

      const completedMessage: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: accumulatedContent || (accumulatedThought ? 'I have completed my reasoning and finished the task.' : 'Task completed.'),
        timestamp: Date.now(),
        thoughts: (accumulatedThought && accumulatedThought.trim().length > 0) ? [{
          id: `th_${Date.now()}`,
          timestamp: startTime,
          content: accumulatedThought,
          durationMs: Date.now() - startTime
        }] : undefined,
        activities: this._currentActivities,
        diffs: this._currentDiffs
      };

      this._events.onComplete(completedMessage);
    } catch (err: any) {
      if (this._abortController?.signal.aborted) {
        this._events.onStatusChange('cancelled');
      } else {
        this._events.onStatusChange('failed');
        this._events.onError(err.message || String(err));
      }
    } finally {
      this._abortController = null;
    }
  }

  private _pruneMessagesForProvider(messages: ChatCompletionMessage[], isGroq: boolean): ChatCompletionMessage[] {
    if (messages.length <= 1) return messages;

    // Find the index of the latest user query
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    // Always include system prompt (messages[0])
    const systemMsg = messages[0];

    // Ensure we start from the last user message to maintain valid chat format (system -> user -> assistant -> tool)
    const activeMessages = lastUserIndex > 0 ? messages.slice(lastUserIndex) : messages.slice(1);

    // Limit tool outputs to stay under Groq's 7,000 ITPM limit
    const maxToolChars = isGroq ? 1000 : 8000;

    const sanitizedActive = activeMessages.map(m => {
      if (m.role === 'tool' && m.content && m.content.length > maxToolChars) {
        return {
          ...m,
          content: m.content.slice(0, maxToolChars) + '\n... [truncated for token limit]'
        };
      }
      return m;
    });

    return [systemMsg, ...sanitizedActive];
  }

  private _mapToolToActivityType(toolName: string): any {
    switch (toolName) {
      case 'read_file':
      case 'list_directory':
      case 'search_files':
        return 'read';
      case 'write_file':
        return 'write';
      case 'replace_block':
        return 'edit';
      case 'run_command':
        return 'command';
      case 'get_diagnostics':
        return 'diagnose';
      case 'delete_file':
        return 'edit';
      default:
        return 'command';
    }
  }

  private _formatActivityTitle(toolCall: ToolCall): string {
    switch (toolCall.name) {
      case 'list_directory':
        return `Inspecting directory ${toolCall.arguments.dirPath || '.'}`;
      case 'read_file':
        return `Reading ${toolCall.arguments.filePath}`;
      case 'write_file':
        return `Writing ${toolCall.arguments.filePath}`;
      case 'replace_block':
        return `Patching ${toolCall.arguments.filePath}`;
      case 'search_files':
        return `Searching for "${toolCall.arguments.query}"`;
      case 'run_command':
        return `Running \`${toolCall.arguments.command}\``;
      case 'get_diagnostics':
        return 'Checking IDE diagnostics (0ms)';
      case 'delete_file':
        return `Deleting ${toolCall.arguments.filePath}`;
      default:
        return `Executing ${toolCall.name}`;
    }
  }

  private _isDangerousAction(toolCall: ToolCall, mode: ExecutionMode): boolean {
    if (mode === 'general') {
      // In general mode, ask confirmation for all mutations
      return ['write_file', 'replace_block', 'run_command', 'delete_file'].includes(toolCall.name);
    }

    // In turbo mode, delete_file always prompts
    if (toolCall.name === 'delete_file') {
      return true;
    }

    if (toolCall.name === 'run_command') {
      const rawCmd = (toolCall.arguments.command || '').trim().toLowerCase();

      // Safe allowlist commands that run autonomously in Turbo mode
      const safePrefixes = [
        'npm test',
        'npm run test',
        'npm run build',
        'npm run lint',
        'npm run typecheck',
        'npx tsc',
        'tsc',
        'npx eslint',
        'eslint',
        'pytest',
        'python -m pytest',
        'cargo test',
        'cargo check',
        'go test',
        'git status',
        'git diff',
        'git log'
      ];

      const isSafe = safePrefixes.some(prefix => rawCmd.startsWith(prefix));
      if (isSafe) {
        return false;
      }

      // Any destructive or non-allowlisted command prompts for confirmation
      return true;
    }

    return false;
  }
}
