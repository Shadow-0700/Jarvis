import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { JarvisWebviewProvider } from './providers/JarvisWebviewProvider';
import { AgentLoop } from './agent/AgentLoop';
import { TimeMachine } from './tools/TimeMachine';
import { StorageManager } from './cache/StorageManager';
import { ProjectScaffolder } from './scaffolder/ProjectScaffolder';
import { ProviderHub } from './agent/ProviderHub';
import { ExecutionMode, PendingApproval } from './types/agent';
import { WebviewToExtensionMessage } from './types/messages';
import { DEFAULT_MODELS } from './types/models';

export function activate(context: vscode.ExtensionContext) {
  // Initialize storage manager (50 MB LRU global cache + .jarvis dir)
  StorageManager.initialize(context);

  const secretStorage = context.secrets;
  const webviewProvider = new JarvisWebviewProvider(context.extensionUri, secretStorage, context.globalState);

  let currentMode: ExecutionMode = 'turbo';
  let currentModel = DEFAULT_MODELS[0].id;
  let activeApprovalResolver: ((approved: boolean) => void) | null = null;

  // Register Webview View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      JarvisWebviewProvider.viewType,
      webviewProvider,
      {
        webviewOptions: { retainContextWhenHidden: true }
      }
    )
  );

  // Initialize Agent Loop
  const agentLoop = new AgentLoop({
    onStatusChange: (status) => {
      webviewProvider.updateStatus(status);
    },
    onThoughtChunk: (chunk, isComplete) => {
      webviewProvider.postMessage({
        type: 'STREAM_THOUGHT',
        payload: { chunk, isComplete }
      });
    },
    onContentChunk: (chunk) => {
      webviewProvider.postMessage({
        type: 'STREAM_CONTENT',
        payload: { chunk }
      });
    },
    onActivityUpdate: (activity) => {
      webviewProvider.postMessage({
        type: 'ACTIVITY_UPDATE',
        payload: { activity }
      });
    },
    onDiffUpdate: (diff) => {
      webviewProvider.postMessage({
        type: 'DIFF_UPDATE',
        payload: { diff }
      });
    },
    onRequestApproval: async (approval: PendingApproval) => {
      webviewProvider.postMessage({
        type: 'REQUEST_APPROVAL',
        payload: { approval }
      });
      return new Promise<boolean>((resolve) => {
        activeApprovalResolver = resolve;
      });
    },
    onComplete: (message) => {
      webviewProvider.addMessage(message);
    },
    onError: (error) => {
      webviewProvider.postMessage({
        type: 'SHOW_ERROR',
        payload: { message: error }
      });
    }
  }, currentMode);

  // Handle messages from Webview
  webviewProvider.setMessageHandler(async (message: WebviewToExtensionMessage) => {
    switch (message.type) {
      case 'SEND_PROMPT': {
        try {
          const target = await ProviderHub.resolveModelTarget(currentModel, secretStorage, context.globalState);

          // Add user message to UI
          webviewProvider.addMessage({
            id: `msg_user_${Date.now()}`,
            role: 'user',
            content: message.payload.text,
            timestamp: Date.now()
          });

          // Run agent task with sensed target model, key, and baseUrl
          agentLoop.runTask(
            message.payload.text,
            target.modelId,
            target.apiKey,
            currentMode,
            target.baseUrl
          );
        } catch (err: any) {
          webviewProvider.postMessage({
            type: 'SHOW_ERROR',
            payload: { message: err.message || String(err) }
          });
        }
        break;
      }

      case 'CANCEL_TASK':
        agentLoop.cancel();
        break;

      case 'SET_MODE':
        currentMode = message.payload.mode;
        webviewProvider.setMode(currentMode);
        break;

      case 'SET_MODEL':
        currentModel = message.payload.modelId;
        webviewProvider.setModel(currentModel);
        break;

      case 'SAVE_KEYS': {
        const keys = message.payload.keys;
        if (keys.openrouter !== undefined) {
          const val = (keys.openrouter || '').trim();
          if (val) {
            await secretStorage.store('jarvis_openrouter_key', val);
            await context.globalState.update('jarvis_openrouter_key', val);
          } else {
            await secretStorage.delete('jarvis_openrouter_key');
            await context.globalState.update('jarvis_openrouter_key', undefined);
          }
        }
        if (keys.nvidia !== undefined) {
          const val = (keys.nvidia || '').trim();
          if (val) {
            await secretStorage.store('jarvis_nvidia_key', val);
            await context.globalState.update('jarvis_nvidia_key', val);
          } else {
            await secretStorage.delete('jarvis_nvidia_key');
            await context.globalState.update('jarvis_nvidia_key', undefined);
          }
        }
        if (keys.groq !== undefined) {
          const val = (keys.groq || '').trim();
          if (val) {
            await secretStorage.store('jarvis_groq_key', val);
            await context.globalState.update('jarvis_groq_key', val);
          } else {
            await secretStorage.delete('jarvis_groq_key');
            await context.globalState.update('jarvis_groq_key', undefined);
          }
        }
        if (keys.gemini !== undefined) {
          const val = (keys.gemini || '').trim();
          if (val) {
            await secretStorage.store('jarvis_gemini_key', val);
            await context.globalState.update('jarvis_gemini_key', val);
          } else {
            await secretStorage.delete('jarvis_gemini_key');
            await context.globalState.update('jarvis_gemini_key', undefined);
          }
        }
        await webviewProvider.sendInitState();
        vscode.window.showInformationMessage('JARVIS: API Key configuration updated successfully!');
        break;
      }

      case 'RESOLVE_APPROVAL':
        if (activeApprovalResolver) {
          activeApprovalResolver(message.payload.approved);
          activeApprovalResolver = null;
        }
        break;

      case 'ROLLBACK_FILE': {
        const restored = TimeMachine.rollbackFile(message.payload.filePath);
        if (restored) {
          vscode.window.showInformationMessage(`JARVIS: Restored ${message.payload.filePath} to original state.`);
        }
        break;
      }

      case 'ROLLBACK_ALL': {
        const count = TimeMachine.rollbackAll().length;
        vscode.window.showInformationMessage(`JARVIS Time Machine: Rolled back ${count} file(s).`);
        break;
      }

      case 'NEW_SESSION':
        agentLoop.resetConversation();
        TimeMachine.newSession();
        webviewProvider.clearMessages();
        await webviewProvider.sendInitState();
        break;

      case 'OPEN_LINK': {
        const linkUrl = message.payload?.url;
        if (linkUrl) {
          if (linkUrl.startsWith('file:///')) {
            const rawPath = linkUrl.replace('file:///', '').replace('file://', '');
            vscode.workspace.openTextDocument(rawPath).then(
              doc => vscode.window.showTextDocument(doc),
              () => vscode.env.openExternal(vscode.Uri.parse(linkUrl))
            );
          } else {
            vscode.env.openExternal(vscode.Uri.parse(linkUrl));
          }
        }
        break;
      }

      case 'FETCH_MODELS': {
        try {
          const target = await ProviderHub.resolveModelTarget(currentModel, secretStorage, context.globalState);
          const modelsUrl = new URL(`${target.baseUrl}/models`);
          const client = modelsUrl.protocol === 'https:' ? https : http;

          const req = client.request({
            hostname: modelsUrl.hostname,
            port: modelsUrl.port || (modelsUrl.protocol === 'https:' ? 443 : 80),
            path: modelsUrl.pathname + modelsUrl.search,
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${target.apiKey}`,
              'Content-Type': 'application/json'
            }
          }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
              try {
                const parsed = JSON.parse(body);
                const rawList = parsed.data || parsed.models || [];
                const models = rawList
                  .map((m: any) => ({
                    id: m.id || m.name,
                    name: m.name || m.id
                  }))
                  .filter((m: any) => Boolean(m.id))
                  .sort((a: any, b: any) => a.id.localeCompare(b.id));

                webviewProvider.postMessage({
                  type: 'MODELS_FETCHED',
                  payload: { models, count: models.length }
                });
                vscode.window.showInformationMessage(`JARVIS: Successfully fetched ${models.length} live models from provider.`);
              } catch (parseErr: any) {
                webviewProvider.postMessage({
                  type: 'SHOW_ERROR',
                  payload: { message: `Failed to parse models response: ${parseErr.message}` }
                });
              }
            });
          });

          req.on('error', (err) => {
            webviewProvider.postMessage({
              type: 'SHOW_ERROR',
              payload: { message: `Failed to fetch models: ${err.message}` }
            });
          });

          req.end();
        } catch (err: any) {
          webviewProvider.postMessage({
            type: 'SHOW_ERROR',
            payload: { message: `Fetch models error: ${err.message}` }
          });
        }
        break;
      }
    }
  });

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.openSidebar', () => {
      vscode.commands.executeCommand('jarvis.sidebarView.focus');
    }),
    vscode.commands.registerCommand('jarvis.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'JARVIS: Set OpenRouter API Key',
        prompt: 'Paste your OpenRouter API Key (it looks like: sk-or-v1-...)',
        password: true,
        placeHolder: 'sk-or-v1-...'
      });
      if (key && key.trim()) {
        const trimmed = key.trim();
        await secretStorage.store('jarvis_openrouter_key', trimmed);
        await context.globalState.update('jarvis_openrouter_key', trimmed);
        await webviewProvider.sendInitState();
        vscode.window.showInformationMessage('JARVIS: OpenRouter API Key saved successfully!');
      }
    }),
    vscode.commands.registerCommand('jarvis.newSession', () => {
      agentLoop.resetConversation();
      TimeMachine.newSession();
      webviewProvider.clearMessages();
      webviewProvider.sendInitState();
    }),
    vscode.commands.registerCommand('jarvis.rollbackAll', () => {
      const count = TimeMachine.rollbackAll().length;
      vscode.window.showInformationMessage(`JARVIS: Rolled back ${count} file(s).`);
    }),
    vscode.commands.registerCommand('jarvis.createProject', async () => {
      const spec = ProjectScaffolder.parseSpec();
      if (!spec) {
        vscode.window.showWarningMessage('No PROJECT.md specification file found in workspace root. Please create a PROJECT.md file first.');
        return;
      }

      vscode.commands.executeCommand('jarvis.sidebarView.focus');

      const nextItem = spec.nextPendingItem;
      const instruction = nextItem
        ? `I am executing the PROJECT.md specification for "${spec.name}". The current pending task is: "${nextItem.text}". Please implement this requirement, verify with diagnostics and tests, and mark it complete.`
        : `All items in PROJECT.md are completed! Running final project verification tests.`;

      const apiKey = (await secretStorage.get('jarvis_openrouter_key')) ||
                     (await secretStorage.get('jarvis_gemini_key')) ||
                     (await secretStorage.get('jarvis_anthropic_key')) ||
                     (await secretStorage.get('jarvis_openai_key'));

      if (!apiKey) {
        vscode.window.showErrorMessage('No API Key configured in JARVIS. Click the settings gear in the sidebar to add a key.');
        return;
      }

      webviewProvider.addMessage({
        id: `msg_scaffold_${Date.now()}`,
        role: 'user',
        content: `Create/Resume Project from PROJECT.md:\n${instruction}`,
        timestamp: Date.now()
      });

      agentLoop.runTask(
        instruction,
        currentModel,
        apiKey,
        currentMode
      );
    })
  );
}

export function deactivate() {}
