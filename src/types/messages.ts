import { ActivityItem, AgentStatus, AgentThought, ChatMessage, DiffItem, ExecutionMode, PendingApproval } from './agent';
import { ModelOption, ProviderKeys } from './models';

// Messages sent from Webview to Extension Host
export type WebviewToExtensionMessage =
  | { type: 'SEND_PROMPT'; payload: { text: string } }
  | { type: 'CANCEL_TASK' }
  | { type: 'SET_MODE'; payload: { mode: ExecutionMode } }
  | { type: 'SET_MODEL'; payload: { modelId: string } }
  | { type: 'SAVE_KEYS'; payload: { keys: ProviderKeys } }
  | { type: 'RESOLVE_APPROVAL'; payload: { approvalId: string; approved: boolean } }
  | { type: 'ROLLBACK_FILE'; payload: { filePath: string } }
  | { type: 'ROLLBACK_ALL' }
  | { type: 'NEW_SESSION' }
  | { type: 'REQUEST_INIT_STATE' }
  | { type: 'OPEN_LINK'; payload: { url: string } }
  | { type: 'FETCH_MODELS' };

// Messages sent from Extension Host to Webview
export type ExtensionToWebviewMessage =
  | { 
      type: 'INIT_STATE'; 
      payload: { 
        status: AgentStatus;
        mode: ExecutionMode;
        currentModel: string;
        availableModels: ModelOption[];
        hasKey: boolean;
        configuredKeys?: Record<string, boolean>;
        messages: ChatMessage[];
        workspaceName?: string;
      } 
    }
  | { type: 'STATUS_CHANGE'; payload: { status: AgentStatus } }
  | { type: 'STREAM_THOUGHT'; payload: { chunk: string; isComplete?: boolean } }
  | { type: 'STREAM_CONTENT'; payload: { chunk: string } }
  | { type: 'ACTIVITY_UPDATE'; payload: { activity: ActivityItem } }
  | { type: 'DIFF_UPDATE'; payload: { diff: DiffItem } }
  | { type: 'REQUEST_APPROVAL'; payload: { approval: PendingApproval } }
  | { type: 'MESSAGE_COMPLETE'; payload: { message: ChatMessage } }
  | { type: 'MODELS_FETCHED'; payload: { models: Array<{ id: string; name: string }>; count: number } }
  | { type: 'SHOW_ERROR'; payload: { message: string } };
