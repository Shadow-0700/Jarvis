import { ToolDefinition, ToolCall, ToolResult } from '../types/tools';
import { FileTools } from './FileTools';
import { ProcessRunner } from './ProcessRunner';
import { DiagnosticWatchdog } from './DiagnosticWatchdog';
import { TimeMachine } from './TimeMachine';
import { RepoMap } from './RepoMap';
import { WorkspaceMemory } from '../memory/WorkspaceMemory';
import { ProjectScaffolder } from '../scaffolder/ProjectScaffolder';
import { LivePreviewManager } from './LivePreviewManager';
import { DiffItem } from '../types/agent';

export interface ToolRegistryOptions {
  onDiffGenerated?: (diff: DiffItem) => void;
  onCommandChunk?: (chunk: string) => void;
}

export class ToolRegistry {
  private _fileTools: FileTools;

  constructor(private readonly _options?: ToolRegistryOptions) {
    this._fileTools = new FileTools({
      onDiffGenerated: this._options?.onDiffGenerated
    });
  }

  public getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'list_directory',
        description: 'Lists files and folders inside the workspace or a given subdirectory. Ignores bulky folders (node_modules, .git, etc.).',
        parameters: {
          type: 'object',
          properties: {
            dirPath: {
              type: 'string',
              description: 'Relative path of the directory to list. Leave empty for workspace root.'
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to list subdirectories recursively (default false).'
            }
          }
        }
      },
      {
        name: 'read_file',
        description: 'Reads the contents of a file in the workspace with optional line range support.',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Relative path of the file to read.'
            },
            startLine: {
              type: 'number',
              description: '1-indexed start line number (optional).'
            },
            endLine: {
              type: 'number',
              description: '1-indexed end line number (optional).'
            }
          },
          required: ['filePath']
        }
      },
      {
        name: 'write_file',
        description: 'Creates a new file or overwrites an existing file with the provided content. Automatic snapshot taken for 1-click rollback.',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Relative path of the file to write.'
            },
            content: {
              type: 'string',
              description: 'The complete content of the file.'
            }
          },
          required: ['filePath', 'content']
        }
      },
      {
        name: 'replace_block',
        description: 'Performs a precise surgical edit by replacing an exact anchor block with new code. Preserves surrounding comments and code.',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Relative path of the file.'
            },
            targetBlock: {
              type: 'string',
              description: 'The exact string/lines of code currently in the file to be replaced.'
            },
            replacementBlock: {
              type: 'string',
              description: 'The new replacement code.'
            }
          },
          required: ['filePath', 'targetBlock', 'replacementBlock']
        }
      },
      {
        name: 'search_files',
        description: 'Searches for text or regex across workspace files, returning matching filenames and lines.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search string or regex.'
            },
            isRegex: {
              type: 'boolean',
              description: 'Whether query is a regular expression.'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'run_command',
        description: 'Executes a shell command (build, test, install, etc.) in the workspace root, capturing exit codes and output up to 10KB.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The terminal command to execute.'
            },
            timeoutMs: {
              type: 'number',
              description: 'Optional timeout in milliseconds (default 60000).'
            }
          },
          required: ['command']
        }
      },
      {
        name: 'get_diagnostics',
        description: 'Reads active compiler, linter, and type-checker errors directly from VS Code language servers in 0ms without running terminal builds.',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Optional relative path to filter diagnostics for a specific file.'
            }
          }
        }
      },
      {
        name: 'delete_file',
        description: 'Moves a file safely to project trash (.jarvis/trash/) with snapshot recovery support.',
        isDangerous: true,
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Relative path of the file to delete.'
            }
          },
          required: ['filePath']
        }
      },
      {
        name: 'get_repo_map',
        description: 'Generates a lightweight symbol outline (classes, functions, interfaces) of workspace files using internal VS Code language servers.',
        parameters: {
          type: 'object',
          properties: {
            maxFiles: {
              type: 'number',
              description: 'Maximum number of source files to map (default 25).'
            }
          }
        }
      },
      {
        name: 'append_workspace_memory',
        description: 'Appends a learned project convention or rule to JARVIS.md for persistent memory across sessions.',
        parameters: {
          type: 'object',
          properties: {
            note: {
              type: 'string',
              description: 'The concise technical learning or rule to record.'
            }
          },
          required: ['note']
        }
      },
      {
        name: 'mark_project_task_complete',
        description: 'Checks off an item (- [x]) in PROJECT.md after its implementation and tests succeed.',
        parameters: {
          type: 'object',
          properties: {
            itemText: {
              type: 'string',
              description: 'The exact text of the checklist item in PROJECT.md.'
            }
          },
          required: ['itemText']
        }
      },
      {
        name: 'preview_website',
        description: 'Launches a live preview of an HTML page or website folder, hosting it on a local HTTP server (http://localhost:3000), opening it automatically in the default browser, and returning the clickable live link.',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path of the HTML file or website directory to preview (e.g. "index.html" or "C:\\Users\\piyus\\Desktop\\basic").'
            },
            port: {
              type: 'number',
              description: 'Optional port number (default 3000).'
            }
          },
          required: ['filePath']
        }
      }
    ];
  }

  public async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    try {
      switch (toolCall.name) {
        case 'list_directory': {
          const files = this._fileTools.listDirectory(
            toolCall.arguments.dirPath || '',
            toolCall.arguments.recursive || false
          );
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: files.length > 0 ? files.join('\n') : '(Directory is empty)'
          };
        }

        case 'read_file': {
          const content = this._fileTools.readFile(
            toolCall.arguments.filePath,
            toolCall.arguments.startLine,
            toolCall.arguments.endLine
          );
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: content
          };
        }

        case 'write_file': {
          const msg = this._fileTools.writeFile(
            toolCall.arguments.filePath,
            toolCall.arguments.content
          );
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: msg
          };
        }

        case 'replace_block': {
          const msg = this._fileTools.replaceBlock(
            toolCall.arguments.filePath,
            toolCall.arguments.targetBlock,
            toolCall.arguments.replacementBlock
          );
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: msg
          };
        }

        case 'search_files': {
          const matches = this._fileTools.searchFiles(
            toolCall.arguments.query,
            toolCall.arguments.isRegex || false
          );
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: matches.length > 0
              ? matches.map(m => `${m.file}:${m.line} -> ${m.text}`).join('\n')
              : 'No matching files found.'
          };
        }

        case 'run_command': {
          const result = await ProcessRunner.executeCommand(
            toolCall.arguments.command,
            toolCall.arguments.timeoutMs || 60000,
            this._options?.onCommandChunk
          );
          
          let output = `Exit code: ${result.exitCode} (${result.durationMs}ms)\n`;
          if (result.combinedOutput) {
            output += `Output:\n${result.combinedOutput}\n`;
          }
          if (result.missingDependencySuggestion) {
            output += `\n[Environment Hint]: ${result.missingDependencySuggestion}\n`;
          }

          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: result.exitCode === 0,
            output,
            metadata: { exitCode: result.exitCode, durationMs: result.durationMs }
          };
        }

        case 'get_diagnostics': {
          const issues = toolCall.arguments.filePath
            ? DiagnosticWatchdog.getFileDiagnostics(toolCall.arguments.filePath)
            : DiagnosticWatchdog.getWorkspaceDiagnostics();

          if (issues.length === 0) {
            return {
              callId: toolCall.id,
              toolName: toolCall.name,
              success: true,
              output: 'No errors or warnings detected by IDE language services.'
            };
          }

          const formatted = issues
            .map(i => `[${i.severity}] ${i.filePath}:${i.line}:${i.column} - ${i.message} (${i.source || 'compiler'})`)
            .join('\n');

          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: `Found ${issues.length} issue(s):\n${formatted}`
          };
        }

        case 'delete_file': {
          const msg = this._fileTools.deleteFile(toolCall.arguments.filePath);
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: msg
          };
        }

        case 'get_repo_map': {
          const map = await RepoMap.generateWorkspaceSymbolMap(toolCall.arguments.maxFiles || 25);
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: map
          };
        }

        case 'append_workspace_memory': {
          const ok = WorkspaceMemory.appendLearning(toolCall.arguments.note);
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: ok,
            output: ok ? `Successfully saved rule to JARVIS.md` : `Failed to write to JARVIS.md`
          };
        }

        case 'mark_project_task_complete': {
          const ok = ProjectScaffolder.markItemCompleted(toolCall.arguments.itemText);
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: ok,
            output: ok ? `Checked off item in PROJECT.md: "${toolCall.arguments.itemText}"` : `Item not found or already checked.`
          };
        }

        case 'preview_website': {
          const liveUrl = await LivePreviewManager.startPreview(
            toolCall.arguments.filePath,
            toolCall.arguments.port || 3000
          );
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: true,
            output: `Live preview launched in your default browser at: ${liveUrl}`
          };
        }

        default:
          return {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: false,
            error: `Unknown tool: ${toolCall.name}`
          };
      }
    } catch (err: any) {
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        error: err.message || String(err)
      };
    }
  }
}
