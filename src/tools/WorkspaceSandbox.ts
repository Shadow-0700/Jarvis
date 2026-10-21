import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class WorkspaceSandbox {
  public static getWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    return folders[0].uri.fsPath;
  }

  public static getCanonicalPath(p: string): string {
    try {
      if (fs.existsSync(p)) {
        return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
      }
    } catch {
      // If file doesn't exist yet, resolve parent
      const parent = path.dirname(p);
      if (fs.existsSync(parent)) {
        const canonicalParent = fs.realpathSync.native ? fs.realpathSync.native(parent) : fs.realpathSync(parent);
        return path.join(canonicalParent, path.basename(p));
      }
    }
    return path.resolve(p);
  }

  public static resolveSafePath(relativeOrAbsolutePath: string): string {
    const root = this.getWorkspaceRoot();

    // If an explicit absolute path is provided by the user
    if (path.isAbsolute(relativeOrAbsolutePath)) {
      const normalizedTarget = path.normalize(relativeOrAbsolutePath);
      const lower = normalizedTarget.toLowerCase();

      // Guard critical OS system directories
      const forbidden = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', '/etc', '/var', '/bin', '/sbin'];
      if (forbidden.some(f => lower.startsWith(f))) {
        throw new Error(`Security Violation: Access to system directory "${normalizedTarget}" is blocked.`);
      }

      return normalizedTarget;
    }

    if (!root) {
      throw new Error('No workspace folder is currently open in VS Code.');
    }

    const candidatePath = path.normalize(path.join(root, relativeOrAbsolutePath));
    return candidatePath;
  }

  public static getRelativePath(absolutePath: string): string {
    const root = this.getWorkspaceRoot();
    if (!root) {
      return absolutePath;
    }
    return path.relative(root, absolutePath);
  }

  public static isSensitiveFile(itemPath: string): boolean {
    const base = path.basename(itemPath).toLowerCase();
    const sensitive = [
      '.env',
      '.env.local',
      '.env.production',
      'id_rsa',
      'id_ed25519',
      '.pem',
      '.key',
      'credentials.json',
      'token.json'
    ];
    return sensitive.some(s => base === s || base.endsWith(s));
  }

  public static isIgnored(itemPath: string): boolean {
    const ignoredPatterns = [
      'node_modules',
      '.git',
      '.vscode',
      'dist',
      'build',
      '.next',
      '.nuxt',
      'coverage',
      '__pycache__',
      '.venv',
      'env',
      '.jarvis',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml'
    ];

    const parts = itemPath.split(/[\\/]/);
    return parts.some(part => ignoredPatterns.includes(part));
  }
}
