import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceSandbox } from '../tools/WorkspaceSandbox';
import { StorageManager } from '../cache/StorageManager';

export interface ProjectChecklistItem {
  index: number;
  text: string;
  completed: boolean;
  rawLine: string;
}

export interface ParsedProjectSpec {
  name: string;
  stack?: string;
  rawContent: string;
  checklist: ProjectChecklistItem[];
  nextPendingItem: ProjectChecklistItem | null;
}

export class ProjectScaffolder {
  public static getProjectSpecPath(): string | null {
    const root = WorkspaceSandbox.getWorkspaceRoot();
    if (!root) {
      return null;
    }
    const candidate = path.join(root, 'PROJECT.md');
    return fs.existsSync(candidate) ? candidate : null;
  }

  public static parseSpec(): ParsedProjectSpec | null {
    const specPath = this.getProjectSpecPath();
    if (!specPath) {
      return null;
    }

    const rawContent = fs.readFileSync(specPath, 'utf8');
    const lines = rawContent.split('\n');

    let projectName = path.basename(path.dirname(specPath));
    let stack: string | undefined;
    const checklist: ProjectChecklistItem[] = [];

    const nameMatch = rawContent.match(/#\s*(?:Project\s*:\s*)?([^\n\r]+)/i);
    if (nameMatch) {
      projectName = nameMatch[1].trim();
    }

    const stackMatch = rawContent.match(/\*\*Stack\*\*:\s*([^\n\r]+)/i);
    if (stackMatch) {
      stack = stackMatch[1].trim();
    }

    const checkRegex = /^\s*-\s*\[([ xX])\]\s*(.+)$/;

    lines.forEach((line, idx) => {
      const match = line.match(checkRegex);
      if (match) {
        const completed = match[1].toLowerCase() === 'x';
        checklist.push({
          index: idx,
          text: match[2].trim(),
          completed,
          rawLine: line
        });
      }
    });

    const nextPendingItem = checklist.find(c => !c.completed) || null;

    return {
      name: projectName,
      stack,
      rawContent,
      checklist,
      nextPendingItem
    };
  }

  public static markItemCompleted(itemText: string): boolean {
    const specPath = this.getProjectSpecPath();
    if (!specPath) {
      return false;
    }

    const rawContent = fs.readFileSync(specPath, 'utf8');
    const lines = rawContent.split('\n');

    let updated = false;
    const updatedLines = lines.map(line => {
      if (!updated && line.includes(itemText) && line.includes('- [ ]')) {
        updated = true;
        return line.replace('- [ ]', '- [x]');
      }
      return line;
    });

    if (updated) {
      fs.writeFileSync(specPath, updatedLines.join('\n'), 'utf8');
      StorageManager.appendAuditLog({
        action: 'project_scaffold_task_completed',
        target: itemText,
        approved: true
      });
      return true;
    }

    return false;
  }
}
