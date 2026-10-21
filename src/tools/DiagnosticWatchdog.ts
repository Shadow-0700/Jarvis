import * as vscode from 'vscode';
import { WorkspaceSandbox } from './WorkspaceSandbox';

export interface DiagnosticIssue {
  filePath: string;
  line: number;
  column: number;
  severity: 'Error' | 'Warning' | 'Information' | 'Hint';
  message: string;
  source?: string;
}

export class DiagnosticWatchdog {
  public static getWorkspaceDiagnostics(): DiagnosticIssue[] {
    const root = WorkspaceSandbox.getWorkspaceRoot();
    if (!root) {
      return [];
    }

    const allDiagnostics = vscode.languages.getDiagnostics();
    const issues: DiagnosticIssue[] = [];

    for (const [uri, diags] of allDiagnostics) {
      if (uri.scheme !== 'file') {
        continue;
      }

      const filePath = uri.fsPath;
      try {
        // Only collect diagnostics within our safe workspace
        WorkspaceSandbox.resolveSafePath(filePath);
      } catch {
        continue;
      }

      for (const diag of diags) {
        // Prioritize Errors and Warnings
        if (diag.severity === vscode.DiagnosticSeverity.Error || diag.severity === vscode.DiagnosticSeverity.Warning) {
          issues.push({
            filePath: WorkspaceSandbox.getRelativePath(filePath),
            line: diag.range.start.line + 1,
            column: diag.range.start.character + 1,
            severity: diag.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning',
            message: diag.message,
            source: diag.source
          });
        }
      }
    }

    return issues;
  }

  public static getFileDiagnostics(filePath: string): DiagnosticIssue[] {
    const resolvedPath = WorkspaceSandbox.resolveSafePath(filePath);
    const uri = vscode.Uri.file(resolvedPath);
    const diags = vscode.languages.getDiagnostics(uri);
    
    return diags.map(diag => ({
      filePath: WorkspaceSandbox.getRelativePath(resolvedPath),
      line: diag.range.start.line + 1,
      column: diag.range.start.character + 1,
      severity: diag.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning',
      message: diag.message,
      source: diag.source
    }));
  }
}
