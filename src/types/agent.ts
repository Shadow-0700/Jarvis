export type AgentStatus = 
  | 'idle' 
  | 'planning' 
  | 'reasoning' 
  | 'executing_tool' 
  | 'diagnosing' 
  | 'repairing' 
  | 'awaiting_approval' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

export type ExecutionMode = 'general' | 'turbo';

export type ActivityType = 
  | 'plan' 
  | 'read' 
  | 'write' 
  | 'edit' 
  | 'command' 
  | 'test' 
  | 'diagnose' 
  | 'repair'
  | 'rollback';

export type ActivityStatus = 'running' | 'success' | 'failed' | 'skipped';

export interface ActivityItem {
  id: string;
  timestamp: number;
  type: ActivityType;
  title: string;
  detail?: string;
  status: ActivityStatus;
  output?: string;
  durationMs?: number;
}

export interface AgentThought {
  id: string;
  timestamp: number;
  content: string;
  durationMs?: number;
  isStreaming?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface DiffItem {
  filePath: string;
  relativeFilePath: string;
  oldContent: string;
  newContent: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  thoughts?: AgentThought[];
  activities?: ActivityItem[];
  diffs?: DiffItem[];
}

export interface PendingApproval {
  id: string;
  actionType: 'command' | 'delete_file' | 'git_push' | 'system_install';
  description: string;
  commandOrPath?: string;
}
