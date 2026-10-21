import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceSandbox } from './WorkspaceSandbox';

export class LivePreviewManager {
  private static _activeServer: http.Server | null = null;
  private static _currentUrl: string | null = null;

  public static async startPreview(filePathOrDir: string, port = 3000): Promise<string> {
    const resolved = WorkspaceSandbox.resolveSafePath(filePathOrDir);
    const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    const baseDir = isDir ? resolved : path.dirname(resolved);
    const indexFile = isDir ? 'index.html' : path.basename(resolved);

    if (this._activeServer) {
      try {
        this._activeServer.close();
      } catch {}
      this._activeServer = null;
    }

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        let reqPath = req.url === '/' ? indexFile : (req.url?.slice(1) || indexFile);
        reqPath = decodeURIComponent(reqPath.split('?')[0]);
        const fullPath = path.join(baseDir, reqPath);

        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const ext = path.extname(fullPath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
          };
          res.writeHead(200, { 
            'Content-Type': mimeTypes[ext] || 'text/plain',
            'Access-Control-Allow-Origin': '*'
          });
          fs.createReadStream(fullPath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 - File Not Found');
        }
      });

      server.listen(port, () => {
        this._activeServer = server;
        const liveUrl = `http://localhost:${port}/`;
        this._currentUrl = liveUrl;
        vscode.env.openExternal(vscode.Uri.parse(liveUrl));
        resolve(liveUrl);
      });

      server.on('error', () => {
        // Fallback to opening file directly if port is busy
        const fallbackUrl = `file:///${resolved.replace(/\\/g, '/')}`;
        vscode.env.openExternal(vscode.Uri.file(resolved));
        resolve(fallbackUrl);
      });
    });
  }

  public static getActiveUrl(): string | null {
    return this._currentUrl;
  }
}
