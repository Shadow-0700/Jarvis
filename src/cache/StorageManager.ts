import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceSandbox } from '../tools/WorkspaceSandbox';

export class StorageManager {
  private static _globalStoragePath: string | null = null;
  private static readonly MAX_GLOBAL_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB
  private static readonly MAX_WORKSPACE_SESSIONS = 20;

  public static initialize(context: vscode.ExtensionContext): void {
    this._globalStoragePath = context.globalStorageUri.fsPath;
    if (!fs.existsSync(this._globalStoragePath)) {
      fs.mkdirSync(this._globalStoragePath, { recursive: true });
    }
    this.runGlobalGarbageCollection();
  }

  public static getWorkspaceJarvisDir(): string | null {
    const root = WorkspaceSandbox.getWorkspaceRoot();
    if (!root) {
      return null;
    }
    const jarvisDir = path.join(root, '.jarvis');
    if (!fs.existsSync(jarvisDir)) {
      fs.mkdirSync(jarvisDir, { recursive: true });
    }
    return jarvisDir;
  }

  public static getTrashDir(): string | null {
    const jarvisDir = this.getWorkspaceJarvisDir();
    if (!jarvisDir) {
      return null;
    }
    const trashDir = path.join(jarvisDir, 'trash');
    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true });
    }
    return trashDir;
  }

  public static getSnapshotsDir(): string | null {
    const jarvisDir = this.getWorkspaceJarvisDir();
    if (!jarvisDir) {
      return null;
    }
    const snapDir = path.join(jarvisDir, 'snapshots');
    if (!fs.existsSync(snapDir)) {
      fs.mkdirSync(snapDir, { recursive: true });
    }
    return snapDir;
  }

  public static appendAuditLog(entry: {
    action: string;
    target?: string;
    approved?: boolean;
    durationMs?: number;
    error?: string;
  }): void {
    const jarvisDir = this.getWorkspaceJarvisDir();
    if (!jarvisDir) {
      return;
    }
    const logPath = path.join(jarvisDir, 'audit.log');
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry
    }) + '\n';

    try {
      fs.appendFileSync(logPath, logLine, 'utf8');
    } catch {
      // Ignore log write issues
    }
  }

  public static runGlobalGarbageCollection(): void {
    if (!this._globalStoragePath || !fs.existsSync(this._globalStoragePath)) {
      return;
    }

    try {
      const files: Array<{ filePath: string; size: number; mtime: number }> = [];
      let totalBytes = 0;

      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else {
            const stats = fs.statSync(fullPath);
            files.push({ filePath: fullPath, size: stats.size, mtime: stats.mtimeMs });
            totalBytes += stats.size;
          }
        }
      };

      scanDir(this._globalStoragePath);

      // LRU Eviction: remove oldest files if total > 50 MB
      if (totalBytes > this.MAX_GLOBAL_CACHE_BYTES) {
        files.sort((a, b) => a.mtime - b.mtime); // Oldest first
        for (const f of files) {
          if (totalBytes <= this.MAX_GLOBAL_CACHE_BYTES) {
            break;
          }
          try {
            fs.unlinkSync(f.filePath);
            totalBytes -= f.size;
          } catch {
            // Ignore individual delete failures
          }
        }
      }
    } catch {
      // Ignore background cleanup errors
    }
  }

  public static pruneWorkspaceSnapshots(): void {
    const snapDir = this.getSnapshotsDir();
    if (!snapDir || !fs.existsSync(snapDir)) {
      return;
    }

    try {
      const sessionDirs = fs.readdirSync(snapDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
          const p = path.join(snapDir, d.name);
          return { path: p, mtime: fs.statSync(p).mtimeMs };
        });

      if (sessionDirs.length > this.MAX_WORKSPACE_SESSIONS) {
        sessionDirs.sort((a, b) => a.mtime - b.mtime); // Oldest first
        const removeCount = sessionDirs.length - this.MAX_WORKSPACE_SESSIONS;
        for (let i = 0; i < removeCount; i++) {
          fs.rmSync(sessionDirs[i].path, { recursive: true, force: true });
        }
      }
    } catch {
      // Ignore background pruning errors
    }
  }
}
