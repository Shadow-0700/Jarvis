import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { ToolDefinition, ToolCall } from '../types/tools';

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface StreamCallbacks {
  onReasoningChunk?: (chunk: string) => void;
  onContentChunk?: (chunk: string) => void;
}

export interface LlmResponse {
  content: string;
  reasoning?: string;
  toolCalls: ToolCall[];
}

export class LlmClient {
  constructor(
    private readonly _apiKey: string,
    private readonly _baseUrl = 'https://openrouter.ai/api/v1'
  ) {}

  public async complete(
    model: string,
    messages: ChatCompletionMessage[],
    tools: ToolDefinition[],
    callbacks?: StreamCallbacks,
    abortSignal?: AbortSignal
  ): Promise<LlmResponse> {
    const formattedTools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const requestBody = JSON.stringify({
      model,
      messages,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      stream: true,
      temperature: 0.2
    });

    const url = new URL(`${this._baseUrl}/chat/completions`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._apiKey}`,
          'HTTP-Referer': 'https://github.com/jarvis-assistant',
          'X-Title': 'JARVIS Agent'
        }
      };

      const req = client.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', chunk => { errBody += chunk; });
          res.on('end', () => {
            reject(new Error(`API Error [HTTP ${res.statusCode}]: ${errBody}`));
          });
          return;
        }

        let fullContent = '';
        let fullReasoning = '';
        const toolCallsMap: Map<number, { id: string; name: string; arguments: string }> = new Map();
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) {
              continue;
            }
            if (trimmed === 'data: [DONE]') {
              continue;
            }
            if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6));

                // Check for in-band SSE errors (e.g. NVIDIA NIM ResourceExhausted or quota errors)
                if (data?.error) {
                  const errorMsg = data.error.message || JSON.stringify(data.error);
                  reject(new Error(`API Error: ${errorMsg}`));
                  return;
                }

                const choice = data.choices?.[0];
                if (!choice) {
                  continue;
                }

                const delta = choice.delta;

                // Handle reasoning/thought streaming (supported by DeepSeek R1, Claude, Gemini Flash 2.0 via OpenRouter)
                const reasoningChunk = delta?.reasoning || delta?.reasoning_content || delta?.thought;
                if (reasoningChunk) {
                  fullReasoning += reasoningChunk;
                  callbacks?.onReasoningChunk?.(reasoningChunk);
                }

                // Handle normal content streaming
                if (delta?.content) {
                  fullContent += delta.content;
                  callbacks?.onContentChunk?.(delta.content);
                }

                // Handle tool calls streaming
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallsMap.has(idx)) {
                      toolCallsMap.set(idx, {
                        id: tc.id || `call_${Date.now()}_${idx}`,
                        name: '',
                        arguments: ''
                      });
                    }
                    const current = toolCallsMap.get(idx)!;
                    if (tc.id) {
                      current.id = tc.id;
                    }
                    if (tc.function?.name) {
                      if (!current.name) {
                        current.name = tc.function.name;
                      } else if (!current.name.includes(tc.function.name)) {
                        current.name += tc.function.name;
                      }
                    }
                    if (tc.function?.arguments) {
                      current.arguments += tc.function.arguments;
                    }
                  }
                }
              } catch {
                // Ignore chunk parse errors
              }
            }
          }
        });

        res.on('end', () => {
          const toolCalls: ToolCall[] = [];
          for (const item of toolCallsMap.values()) {
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(item.arguments || '{}');
            } catch {
              parsedArgs = { raw: item.arguments };
            }
            toolCalls.push({
              id: item.id,
              name: item.name,
              arguments: parsedArgs
            });
          }

          resolve({
            content: fullContent,
            reasoning: fullReasoning || undefined,
            toolCalls
          });
        });
      });

      req.setTimeout(25000, () => {
        req.destroy(new Error('Connection timed out after 25 seconds.'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          req.destroy(new Error('Operation cancelled by user.'));
        });
      }

      req.write(requestBody);
      req.end();
    });
  }
}
