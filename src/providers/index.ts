/**
 * Provider barrel — re-exports every concrete provider and exposes a
 * single `resolveProvider()` factory that maps a ProviderType string
 * to the correct provider instance.
 */

export { BaseLLMProvider } from './base.provider';
export { OllamaProvider } from './ollama.provider';
export { LmStudioProvider } from './lmstudio.provider';
export { GoogleProvider } from './google.provider';
export { GroqProvider } from './groq.provider';
export { OpenRouterProvider } from './openrouter.provider';
export { OpenAIProvider } from './openai.provider';
export { AnthropicProvider } from './anthropic.provider';

import { ProviderType } from '../types/llm.types';
import type { BaseLLMProvider } from './base.provider';
import { OllamaProvider } from './ollama.provider';
import { LmStudioProvider } from './lmstudio.provider';
import { GoogleProvider } from './google.provider';
import { GroqProvider } from './groq.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { OpenAIProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';

/**
 * Resolves the correct provider instance based on the active config values.
 *
 * @param providerType - The ProviderType string from glyph.config
 * @param baseUrl      - The base endpoint URL (only used by local providers)
 * @param apiKey       - API key (only used by cloud providers)
 */
export function resolveProvider(
    providerType: string,
    baseUrl: string,
    apiKey?: string,
): BaseLLMProvider {
    switch (providerType) {
        case ProviderType.Ollama:
            return new OllamaProvider(baseUrl);

        case ProviderType.LmStudio:
            return new LmStudioProvider(baseUrl);

        case ProviderType.Google:
        case 'Gemini':
            return new GoogleProvider(apiKey || '');

        case ProviderType.OpenRouter:
        case 'OpenRouter':
            return new OpenRouterProvider(apiKey || '');

        case 'Groq':
            return new GroqProvider(apiKey || '');

        case ProviderType.OpenAI:
            return new OpenAIProvider(apiKey || '', baseUrl);

        case ProviderType.Anthropic:
            return new AnthropicProvider(apiKey || '');

        default:
            // Fallback to Ollama for unrecognised types
            console.warn(`[ProviderResolver] Unknown providerType "${providerType}", falling back to Ollama.`);
            return new OllamaProvider(baseUrl);
    }
}
