export type ModelProvider = 'openrouter' | 'anthropic' | 'openai' | 'gemini' | 'groq' | 'custom';

export interface ModelTierConfig {
  fastModel: string;      // e.g. 'google/gemini-2.0-flash-001' or 'claude-3-5-haiku-latest'
  reasoningModel: string; // e.g. 'anthropic/claude-3.7-sonnet' or 'gpt-4o'
}

export interface ModelOption {
  id: string;
  name: string;
  provider: ModelProvider;
  contextWindow: number;
  supportsTools: boolean;
  supportsReasoning: boolean;
  isCustom?: boolean;
}

export const DEFAULT_MODELS: ModelOption[] = [
  {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    name: 'NVIDIA Nemotron 3.5 Lightning (Verified Fast)',
    provider: 'custom',
    contextWindow: 131072,
    supportsTools: true,
    supportsReasoning: true
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    name: 'NVIDIA Nemotron 3 Ultra 550B (Flagship)',
    provider: 'custom',
    contextWindow: 131072,
    supportsTools: true,
    supportsReasoning: true
  },
  {
    id: 'openrouter/free',
    name: 'OpenRouter Auto Free (Always Active)',
    provider: 'openrouter',
    contextWindow: 128000,
    supportsTools: true,
    supportsReasoning: true
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 (Thinking Free)',
    provider: 'openrouter',
    contextWindow: 128000,
    supportsTools: true,
    supportsReasoning: true
  }
];

export interface ProviderKeys {
  openrouter?: string;
  nvidia?: string;
  anthropic?: string;
  openai?: string;
  gemini?: string;
  groq?: string;
  customEndpoint?: string;
  customKey?: string;
}
