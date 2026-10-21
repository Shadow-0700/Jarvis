import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceSandbox } from '../tools/WorkspaceSandbox';
import { StorageManager } from '../cache/StorageManager';

export class WorkspaceMemory {
  public static getMemoryFilePath(): string | null {
    const root = WorkspaceSandbox.getWorkspaceRoot();
    if (!root) {
      return null;
    }
    return path.join(root, 'JARVIS.md');
  }

  public static loadMemory(): string | null {
    const memoryFile = this.getMemoryFilePath();
    if (!memoryFile || !fs.existsSync(memoryFile)) {
      return null;
    }
    try {
      return fs.readFileSync(memoryFile, 'utf8');
    } catch {
      return null;
    }
  }

  public static appendLearning(note: string): boolean {
    const memoryFile = this.getMemoryFilePath();
    if (!memoryFile) {
      return false;
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const formattedNote = `\n- [${timestamp}] ${note}`;

    try {
      if (!fs.existsSync(memoryFile)) {
        const header = '# JARVIS Workspace Memory\n\nProject rules, test commands, and learned conventions.\n\n## Auto-Learned Conventions\n';
        fs.writeFileSync(memoryFile, header + formattedNote, 'utf8');
      } else {
        fs.appendFileSync(memoryFile, formattedNote, 'utf8');
      }

      StorageManager.appendAuditLog({
        action: 'append_workspace_memory',
        target: note,
        approved: true
      });

      return true;
    } catch {
      return false;
    }
  }
}
