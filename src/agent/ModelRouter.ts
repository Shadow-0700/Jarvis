export type TaskTier = 'fast' | 'reasoning';

export class ModelRouter {
  private _consecutiveFastFailures = 0;

  public classifyTask(userPrompt: string): TaskTier {
    const prompt = userPrompt.toLowerCase();

    // Explicit user overrides
    if (prompt.startsWith('/fast')) {
      return 'fast';
    }
    if (prompt.startsWith('/strong') || prompt.startsWith('/reasoning')) {
      return 'reasoning';
    }

    // Fast-tier heuristics: lookups, search, read, diagnostics, small renames
    const fastKeywords = [
      'find', 'locate', 'search', 'where is', 'read', 'list files',
      'check errors', 'check diagnostics', 'rename variable', 'format',
      'what is', 'explain error'
    ];

    // Strong-tier heuristics: deep planning, scaffolding, refactoring, full stack build, debugging
    const reasoningKeywords = [
      'build', 'create project', 'scaffold', 'architect', 'refactor',
      'implement authentication', 'fix test', 'debug bug', 'integrate',
      'full stack', 'database migration', 'dockerize'
    ];

    if (reasoningKeywords.some(k => prompt.includes(k))) {
      return 'reasoning';
    }

    if (fastKeywords.some(k => prompt.includes(k))) {
      return 'fast';
    }

    return 'reasoning';
  }

  public recordFailure(): void {
    this._consecutiveFastFailures++;
  }

  public recordSuccess(): void {
    this._consecutiveFastFailures = 0;
  }

  public shouldAutoEscalate(): boolean {
    return this._consecutiveFastFailures >= 2;
  }

  public getFallbackModel(currentModel: string): string | null {
    // Fallback chain for 429 / rate limit relief
    const fallbackMap: Record<string, string> = {
      'google/gemini-2.0-flash-exp:free': 'meta-llama/llama-3.3-70b-instruct:free',
      'meta-llama/llama-3.3-70b-instruct:free': 'qwen/qwen-2.5-coder-32b-instruct:free',
      'deepseek/deepseek-r1:free': 'meta-llama/llama-3.3-70b-instruct:free'
    };

    return fallbackMap[currentModel] || 'meta-llama/llama-3.3-70b-instruct:free';
  }
}
