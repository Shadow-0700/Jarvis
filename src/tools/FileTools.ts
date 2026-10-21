import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceSandbox } from './WorkspaceSandbox';
import { TimeMachine } from './TimeMachine';
import { StorageManager } from '../cache/StorageManager';
import { DiffItem } from '../types/agent';

export interface FileToolsOptions {
  onDiffGenerated?: (diff: DiffItem) => void;
}

export class FileTools {
  constructor(private readonly _options?: FileToolsOptions) {}

  public listDirectory(dirPath = '', recursive = false, maxDepth = 2): string[] {
    const resolved = WorkspaceSandbox.resolveSafePath(dirPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const results: string[] = [];

    const walk = (currentDir: string, currentDepth: number) => {
      if (currentDepth > maxDepth) {
        return;
      }
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = WorkspaceSandbox.getRelativePath(fullPath);

        if (WorkspaceSandbox.isIgnored(relPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          results.push(`${relPath}/`);
          if (recursive) {
            walk(fullPath, currentDepth + 1);
          }
        } else {
          results.push(relPath);
        }
      }
    };

    walk(resolved, 1);
    return results;
  }

  public readFile(filePath: string, startLine?: number, endLine?: number): string {
    const resolved = WorkspaceSandbox.resolveSafePath(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n');

    if (startLine !== undefined || endLine !== undefined) {
      const start = Math.max(1, startLine || 1);
      const end = Math.min(lines.length, endLine || lines.length);
      const sliced = lines.slice(start - 1, end);
      return sliced.map((line, idx) => `${start + idx}: ${line}`).join('\n');
    }

    return content;
  }

  public writeFile(filePath: string, content: string): string {
    const resolved = WorkspaceSandbox.resolveSafePath(filePath);
    TimeMachine.recordFileState(resolved);

    const oldContent = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : '';
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolved, content, 'utf8');

    if (this._options?.onDiffGenerated) {
      this._options.onDiffGenerated({
        filePath: resolved,
        relativeFilePath: WorkspaceSandbox.getRelativePath(resolved),
        oldContent,
        newContent: content
      });
    }

    return `Successfully wrote file: ${WorkspaceSandbox.getRelativePath(resolved)} (${content.length} bytes)`;
  }

  public replaceBlock(filePath: string, targetBlock: string, replacementBlock: string): string {
    const resolved = WorkspaceSandbox.resolveSafePath(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${filePath}`);
    }

    TimeMachine.recordFileState(resolved);
    const originalContent = fs.readFileSync(resolved, 'utf8');

    // Normalize CRLF to LF for reliable matching
    const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');
    const normalizedTarget = targetBlock.replace(/\r\n/g, '\n');
    const normalizedReplacement = replacementBlock.replace(/\r\n/g, '\n');

    if (!normalizedOriginal.includes(normalizedTarget)) {
      throw new Error(
        `Target block was not found in ${WorkspaceSandbox.getRelativePath(filePath)}. Ensure the target string matches the existing lines exactly.`
      );
    }

    const updatedContent = normalizedOriginal.replace(normalizedTarget, normalizedReplacement);
    fs.writeFileSync(resolved, updatedContent, 'utf8');

    if (this._options?.onDiffGenerated) {
      this._options.onDiffGenerated({
        filePath: resolved,
        relativeFilePath: WorkspaceSandbox.getRelativePath(resolved),
        oldContent: originalContent,
        newContent: updatedContent
      });
    }

    return `Successfully applied targeted edit in ${WorkspaceSandbox.getRelativePath(filePath)}`;
  }

  public searchFiles(query: string, isRegex = false, maxResults = 30): Array<{ file: string; line: number; text: string }> {
    const root = WorkspaceSandbox.getWorkspaceRoot() || process.env.USERPROFILE || '.';

    const results: Array<{ file: string; line: number; text: string }> = [];
    const pattern = isRegex ? new RegExp(query, 'i') : null;

    const searchInDir = (dir: string) => {
      if (results.length >= maxResults) {
        return;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) {
          return;
        }
        const fullPath = path.join(dir, entry.name);
        const relPath = WorkspaceSandbox.getRelativePath(fullPath);

        if (WorkspaceSandbox.isIgnored(relPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          searchInDir(fullPath);
        } else if (entry.isFile()) {
          // Skip binary files and large files (> 1MB)
          const stats = fs.statSync(fullPath);
          if (stats.size > 1024 * 1024) {
            continue;
          }

          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) {
                break;
              }
              const line = lines[i];
              const matches = pattern ? pattern.test(line) : line.toLowerCase().includes(query.toLowerCase());
              if (matches) {
                results.push({
                  file: relPath,
                  line: i + 1,
                  text: line.trim()
                });
              }
            }
          } catch {
            // Ignore unreadable/binary files
          }
        }
      }
    };

    searchInDir(root);
    return results;
  }

  public deleteFile(filePath: string): string {
    const resolved = WorkspaceSandbox.resolveSafePath(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${filePath}`);
    }

    TimeMachine.recordFileState(resolved);

    // Soft delete: move to .jarvis/trash/
    const trashDir = StorageManager.getTrashDir();
    const relPath = WorkspaceSandbox.getRelativePath(resolved);
    if (trashDir) {
      const timestamp = Date.now();
      const trashFileName = `${timestamp}_${path.basename(resolved)}`;
      const trashPath = path.join(trashDir, trashFileName);
      fs.renameSync(resolved, trashPath);

      // Save metadata
      fs.writeFileSync(`${trashPath}.meta.json`, JSON.stringify({
        originalPath: resolved,
        relativePath: relPath,
        deletedAt: timestamp
      }, null, 2), 'utf8');

      StorageManager.appendAuditLog({
        action: 'delete_file (soft trash)',
        target: relPath,
        approved: true
      });

      return `Safely moved ${relPath} to project trash (.jarvis/trash/${trashFileName})`;
    }

    fs.unlinkSync(resolved);
    return `Deleted file: ${relPath}`;
  }
}
