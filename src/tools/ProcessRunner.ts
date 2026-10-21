import { spawn, ChildProcess } from 'child_process';
import { WorkspaceSandbox } from './WorkspaceSandbox';

export interface CommandResult {
  stdout: string;
  stderr: string;
  combinedOutput: string;
  exitCode: number;
  durationMs: number;
  timedOut?: boolean;
  cancelled?: boolean;
  missingDependencySuggestion?: string;
}

export class ProcessRunner {
  private static _currentProcess: ChildProcess | null = null;

  public static async executeCommand(
    command: string,
    timeoutMs = 60000,
    onChunk?: (chunk: string) => void
  ): Promise<CommandResult> {
    const root = WorkspaceSandbox.getWorkspaceRoot() || process.env.USERPROFILE || '.';

    const startTime = Date.now();
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let combined = '';
      let isTimedOut = false;
      let isCancelled = false;

      const child = spawn(shell, shellArgs, {
        cwd: root,
        env: { ...process.env, FORCE_COLOR: '0' }
      });

      this._currentProcess = child;

      const MAX_OUTPUT_BYTES = 10 * 1024; // 10KB cap

      const appendSafe = (text: string, isErr = false) => {
        if (isErr) {
          stderr += text;
        } else {
          stdout += text;
        }
        combined += text;

        if (combined.length > MAX_OUTPUT_BYTES) {
          combined = '... [Output truncated to last 10KB] ...\n' + combined.slice(-MAX_OUTPUT_BYTES);
        }

        if (onChunk) {
          onChunk(text);
        }
      };

      child.stdout?.on('data', (data) => appendSafe(data.toString()));
      child.stderr?.on('data', (data) => appendSafe(data.toString(), true));

      const timer = setTimeout(() => {
        isTimedOut = true;
        this.cancelCurrentCommand();
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        this._currentProcess = null;
        const durationMs = Date.now() - startTime;
        const exitCode = code ?? (isTimedOut ? -1 : 0);

        let missingDependencySuggestion: string | undefined;
        if (exitCode !== 0) {
          missingDependencySuggestion = this._detectMissingTool(combined);
        }

        resolve({
          stdout,
          stderr,
          combinedOutput: combined.trim(),
          exitCode,
          durationMs,
          timedOut: isTimedOut,
          cancelled: isCancelled,
          missingDependencySuggestion
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this._currentProcess = null;
        appendSafe(`Process execution error: ${err.message}`, true);
        resolve({
          stdout,
          stderr,
          combinedOutput: combined.trim(),
          exitCode: 1,
          durationMs: Date.now() - startTime,
          timedOut: false,
          cancelled: false
        });
      });
    });
  }

  public static cancelCurrentCommand(): void {
    if (this._currentProcess && !this._currentProcess.killed) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', this._currentProcess.pid!.toString(), '/f', '/t']);
      } else {
        this._currentProcess.kill('SIGINT');
      }
      this._currentProcess = null;
    }
  }

  private static _detectMissingTool(output: string): string | undefined {
    const isWindows = process.platform === 'win32';
    const notRecognizedRegex = /'([^']+)' is not recognized as an internal or external command/i;
    const notFoundRegex = /command not found: ([^\s]+)/i;

    const match = output.match(isWindows ? notRecognizedRegex : notFoundRegex);
    if (match && match[1]) {
      const tool = match[1];
      if (isWindows) {
        return `Missing tool "${tool}". You can install it using winget: "winget install ${tool}" or npm.`;
      } else {
        return `Missing tool "${tool}". You can install it using brew or apt: "brew install ${tool}" or "sudo apt install ${tool}".`;
      }
    }
    return undefined;
  }
}
