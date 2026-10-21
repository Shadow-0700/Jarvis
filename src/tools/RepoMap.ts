import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceSandbox } from './WorkspaceSandbox';

export interface FileSymbolSummary {
  filePath: string;
  symbols: string[];
}

export class RepoMap {
  public static async generateWorkspaceSymbolMap(maxFiles = 25): Promise<string> {
    const root = WorkspaceSandbox.getWorkspaceRoot();
    if (!root) {
      return '(No workspace open)';
    }

    const summaries: FileSymbolSummary[] = [];
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c'];

    const scanFiles = (dir: string) => {
      if (summaries.length >= maxFiles) {
        return;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (summaries.length >= maxFiles) {
          return;
        }
        const fullPath = path.join(dir, entry.name);
        const relPath = WorkspaceSandbox.getRelativePath(fullPath);

        if (WorkspaceSandbox.isIgnored(relPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          scanFiles(fullPath);
        } else if (entry.isFile() && sourceExtensions.includes(path.extname(entry.name))) {
          summaries.push({ filePath: relPath, symbols: [] });
        }
      }
    };

    scanFiles(root);

    // Extract symbols using VS Code's internal language server
    const results: string[] = [];
    for (const item of summaries) {
      try {
        const fullPath = WorkspaceSandbox.resolveSafePath(item.filePath);
        const uri = vscode.Uri.file(fullPath);
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider',
          uri
        );

        if (symbols && symbols.length > 0) {
          const names = symbols
            .slice(0, 10)
            .map(s => {
              const kindName = vscode.SymbolKind[s.kind] || 'symbol';
              return `${s.name} (${kindName})`;
            });
          results.push(`- ${item.filePath}: ${names.join(', ')}`);
        } else {
          results.push(`- ${item.filePath}`);
        }
      } catch {
        results.push(`- ${item.filePath}`);
      }
    }

    return results.length > 0 ? results.join('\n') : '(No source files detected)';
  }
}
