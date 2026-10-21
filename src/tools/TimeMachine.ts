import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceSandbox } from './WorkspaceSandbox';
import { StorageManager } from '../cache/StorageManager';

export interface FileSnapshot {
  filePath: string;
  originalContent: string | null;
  timestamp: number;
}

export class TimeMachine {
  private static _currentSessionId = `session_${Date.now()}`;
  private static _snapshots: Map<string, FileSnapshot> = new Map();

  public static getSessionDir(): string | null {
    const snapshotsDir = StorageManager.getSnapshotsDir();
    if (!snapshotsDir) {
      return null;
    }
    const dir = path.join(snapshotsDir, this._currentSessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public static recordFileState(filePath: string): void {
    const resolvedPath = WorkspaceSandbox.resolveSafePath(filePath);
    if (this._snapshots.has(resolvedPath)) {
      return;
    }

    let originalContent: string | null = null;
    if (fs.existsSync(resolvedPath)) {
      originalContent = fs.readFileSync(resolvedPath, 'utf8');
    }

    const snapshot: FileSnapshot = {
      filePath: resolvedPath,
      originalContent,
      timestamp: Date.now()
    };

    this._snapshots.set(resolvedPath, snapshot);

    // Persist to disk in .jarvis/snapshots/<sessionId>/
    const sessionDir = this.getSessionDir();
    if (sessionDir) {
      try {
        const safeFileName = Buffer.from(WorkspaceSandbox.getRelativePath(resolvedPath)).toString('base64url') + '.bak';
        const backupFile = path.join(sessionDir, safeFileName);
        const metaFile = path.join(sessionDir, safeFileName + '.meta.json');

        if (originalContent !== null) {
          fs.writeFileSync(backupFile, originalContent, 'utf8');
        }

        fs.writeFileSync(metaFile, JSON.stringify({
          originalPath: resolvedPath,
          relativePath: WorkspaceSandbox.getRelativePath(resolvedPath),
          existed: originalContent !== null,
          timestamp: Date.now()
        }, null, 2), 'utf8');
      } catch {
        // Fallback to in-memory only if disk write encounters error
      }
    }
  }

  public static rollbackFile(filePath: string): boolean {
    const resolvedPath = WorkspaceSandbox.resolveSafePath(filePath);
    const snapshot = this._snapshots.get(resolvedPath);
    if (!snapshot) {
      return false;
    }

    if (snapshot.originalContent === null) {
      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
      }
    } else {
      fs.writeFileSync(resolvedPath, snapshot.originalContent, 'utf8');
    }

    StorageManager.appendAuditLog({
      action: 'rollback_file',
      target: WorkspaceSandbox.getRelativePath(resolvedPath),
      approved: true
    });

    this._snapshots.delete(resolvedPath);
    return true;
  }

  public static rollbackAll(): string[] {
    const restored: string[] = [];
    for (const [filePath, snapshot] of this._snapshots.entries()) {
      if (snapshot.originalContent === null) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } else {
        fs.writeFileSync(filePath, snapshot.originalContent, 'utf8');
      }
      restored.push(filePath);
    }

    StorageManager.appendAuditLog({
      action: 'rollback_all',
      target: `${restored.length} file(s)`,
      approved: true
    });

    this._snapshots.clear();
    return restored;
  }

  public static newSession(): void {
    this._snapshots.clear();
    this._currentSessionId = `session_${Date.now()}`;
    StorageManager.pruneWorkspaceSnapshots();
  }

  public static clearSessionSnapshots(): void {
    this.newSession();
  }

  public static getTouchedFiles(): string[] {
    return Array.from(this._snapshots.keys());
  }
}
