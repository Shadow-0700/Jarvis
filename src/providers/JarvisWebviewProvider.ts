import * as vscode from 'vscode';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types/messages';
import { AgentStatus, ExecutionMode, ChatMessage } from '../types/agent';
import { DEFAULT_MODELS } from '../types/models';
import { ProviderHub } from '../agent/ProviderHub';

export class JarvisWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'jarvis.sidebarView';
  private _view?: vscode.WebviewView;
  private _messageHandler?: (message: WebviewToExtensionMessage) => Promise<void>;

  private _status: AgentStatus = 'idle';
  private _mode: ExecutionMode = 'turbo';
  private _currentModel: string = DEFAULT_MODELS[0].id;
  private _messages: ChatMessage[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _secretStorage: vscode.SecretStorage,
    private readonly _globalState?: vscode.Memento
  ) {}

  public setMessageHandler(handler: (message: WebviewToExtensionMessage) => Promise<void>) {
    this._messageHandler = handler;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      if (message.type === 'REQUEST_INIT_STATE') {
        await this.sendInitState();
        return;
      }
      if (this._messageHandler) {
        await this._messageHandler(message);
      }
    });
  }

  public async sendInitState() {
    const configuredKeys = await ProviderHub.getConfiguredProviders(this._secretStorage, this._globalState);
    const hasKey = Object.values(configuredKeys).some(Boolean);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceName = workspaceFolders && workspaceFolders.length > 0 
      ? workspaceFolders[0].name 
      : 'No folder open';

    this.postMessage({
      type: 'INIT_STATE',
      payload: {
        status: this._status,
        mode: this._mode,
        currentModel: this._currentModel,
        availableModels: DEFAULT_MODELS,
        hasKey,
        configuredKeys,
        messages: this._messages,
        workspaceName
      }
    });
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  public updateStatus(status: AgentStatus) {
    this._status = status;
    this.postMessage({ type: 'STATUS_CHANGE', payload: { status } });
  }

  public setMode(mode: ExecutionMode) {
    this._mode = mode;
  }

  public setModel(modelId: string) {
    this._currentModel = modelId;
  }

  public addMessage(message: ChatMessage) {
    this._messages.push(message);
    this.postMessage({ type: 'MESSAGE_COMPLETE', payload: { message } });
  }

  public clearMessages() {
    this._messages = [];
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'styles.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource} https://fonts.googleapis.com; font-src ${webview.cspSource} https://fonts.gstatic.com data:; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; connect-src https:;">
  <title>JARVIS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
