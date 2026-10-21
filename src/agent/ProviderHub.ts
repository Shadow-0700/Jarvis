import * as vscode from 'vscode';
import { ModelProvider } from '../types/models';

export interface ResolvedModelTarget {
  provider: ModelProvider;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  isDirectProvider: boolean;
}

export class ProviderHub {
  public static async resolveModelTarget(
    requestedModelId: string,
    secretStorage: vscode.SecretStorage,
    globalState?: vscode.Memento
  ): Promise<ResolvedModelTarget> {
    const openrouterKey = (await secretStorage.get('jarvis_openrouter_key')) || globalState?.get<string>('jarvis_openrouter_key');
    const geminiKey = (await secretStorage.get('jarvis_gemini_key')) || globalState?.get<string>('jarvis_gemini_key');
    const openaiKey = (await secretStorage.get('jarvis_openai_key')) || globalState?.get<string>('jarvis_openai_key');
    const anthropicKey = (await secretStorage.get('jarvis_anthropic_key')) || globalState?.get<string>('jarvis_anthropic_key');
    const groqKey = (await secretStorage.get('jarvis_groq_key')) || globalState?.get<string>('jarvis_groq_key');
    const nvidiaKey = (await secretStorage.get('jarvis_nvidia_key')) || globalState?.get<string>('jarvis_nvidia_key');

    const lowerId = requestedModelId.toLowerCase();

    // 1. Direct Groq routing
    const isExplicitGroq = lowerId.startsWith('groq/') || lowerId.includes('qwen') || lowerId.includes('oss') || lowerId.includes('groq') || lowerId.includes('versatile') || lowerId.includes('instant') || lowerId.includes('distill') || lowerId.includes('llama');
    if (groqKey && groqKey.trim() && (isExplicitGroq || (!nvidiaKey && !openrouterKey))) {
      let cleanModel = requestedModelId.replace(/^groq\//, '');
      const cleanLower = cleanModel.toLowerCase();
      if (cleanLower.includes('120b') || cleanLower.includes('gpt')) {
        cleanModel = 'openai/gpt-oss-120b';
      } else if (cleanLower.includes('20b')) {
        cleanModel = 'openai/gpt-oss-20b';
      } else {
        // Default to ultra-fast Qwen 3.8 27B running at 750 tok/s on Groq LPU
        cleanModel = 'qwen/qwen3.8-27b';
      }

      return {
        provider: 'groq',
        modelId: cleanModel,
        apiKey: groqKey.trim(),
        baseUrl: 'https://api.groq.com/openai/v1',
        isDirectProvider: true
      };
    }

    // 2. Direct NVIDIA NIM detection (nvapi-... keys or saved nvidia key)
    const hasNvidiaKey = (nvidiaKey && nvidiaKey.trim()) || (openrouterKey && openrouterKey.trim().startsWith('nvapi-'));
    if (hasNvidiaKey) {
      const activeKey = (nvidiaKey && nvidiaKey.trim()) || openrouterKey!.trim();
      let cleanModel = requestedModelId.replace(/^nvidia\//, '');

      // Map models to active, verified NVIDIA NIM endpoints
      const lower = cleanModel.toLowerCase();
      if (
        lower.includes(':free') || 
        lower.startsWith('openrouter/') || 
        lower.startsWith('google/') ||
        lower.includes('deepseek') ||
        lower.includes('llama-3.3') ||
        lower.includes('nemotron-70b') ||
        lower.includes('qwen')
      ) {
        if (lower.includes('laguna') || lower.includes('poolside')) {
          cleanModel = 'poolside/laguna-xs-2.1';
        } else if (lower.includes('ultra') || lower.includes('550b')) {
          cleanModel = 'nvidia/nemotron-3-ultra-550b-a55b';
        } else if (lower.includes('step')) {
          cleanModel = 'stepfun-ai/step-5-preview';
        } else {
          cleanModel = 'nvidia/nemotron-3.5-lightning-30b-a3b';
        }
      }

      return {
        provider: 'openai',
        modelId: cleanModel,
        apiKey: activeKey,
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        isDirectProvider: true
      };
    }

    // 1. If OpenRouter key is set, it handles ANY model seamlessly
    if (openrouterKey && openrouterKey.trim()) {
      return {
        provider: 'openrouter',
        modelId: requestedModelId,
        apiKey: openrouterKey.trim(),
        baseUrl: 'https://openrouter.ai/api/v1',
        isDirectProvider: false
      };
    }

    // 2. Direct Gemini Key
    if (geminiKey && geminiKey.trim()) {
      const cleanModel = lowerId.includes('flash') ? 'gemini-2.0-flash' : (lowerId.includes('pro') ? 'gemini-1.5-pro' : requestedModelId);
      return {
        provider: 'gemini',
        modelId: cleanModel,
        apiKey: geminiKey.trim(),
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        isDirectProvider: true
      };
    }

    // 3. Direct OpenAI Key
    if (openaiKey && openaiKey.trim()) {
      return {
        provider: 'openai',
        modelId: requestedModelId.replace(/^openai\//, ''),
        apiKey: openaiKey.trim(),
        baseUrl: 'https://api.openai.com/v1',
        isDirectProvider: true
      };
    }

    // 4. Direct Groq Key
    if (groqKey && groqKey.trim()) {
      return {
        provider: 'groq',
        modelId: requestedModelId.replace(/^groq\//, ''),
        apiKey: groqKey.trim(),
        baseUrl: 'https://api.groq.com/openai/v1',
        isDirectProvider: true
      };
    }

    // 5. Direct Anthropic Key
    if (anthropicKey && anthropicKey.trim()) {
      return {
        provider: 'anthropic',
        modelId: requestedModelId.replace(/^anthropic\//, ''),
        apiKey: anthropicKey.trim(),
        baseUrl: 'https://api.anthropic.com/v1',
        isDirectProvider: true
      };
    }

    throw new Error(
      `No API key configured. Click ⚙ in the top-right, paste your OpenRouter key, and click Save.`
    );
  }

  public static async getConfiguredProviders(
    secretStorage: vscode.SecretStorage,
    globalState?: vscode.Memento
  ): Promise<Record<string, boolean>> {
    const hasOr = !!(await secretStorage.get('jarvis_openrouter_key')) || !!globalState?.get<string>('jarvis_openrouter_key');
    const hasGemini = !!(await secretStorage.get('jarvis_gemini_key')) || !!globalState?.get<string>('jarvis_gemini_key');
    const hasOpenai = !!(await secretStorage.get('jarvis_openai_key')) || !!globalState?.get<string>('jarvis_openai_key');
    const hasAnthropic = !!(await secretStorage.get('jarvis_anthropic_key')) || !!globalState?.get<string>('jarvis_anthropic_key');
    const hasGroq = !!(await secretStorage.get('jarvis_groq_key')) || !!globalState?.get<string>('jarvis_groq_key');
    const hasNvidia = !!(await secretStorage.get('jarvis_nvidia_key')) || !!globalState?.get<string>('jarvis_nvidia_key') || (hasOr && (await secretStorage.get('jarvis_openrouter_key'))?.startsWith('nvapi-'));

    return {
      openrouter: hasOr,
      nvidia: Boolean(hasNvidia),
      gemini: hasGemini,
      openai: hasOpenai,
      anthropic: hasAnthropic,
      groq: hasGroq
    };
  }
}
