/**
 * Adapter barrel — re-exports every concrete adapter and exposes a
 * single `resolveAdapter()` factory that maps a ProviderType string
 * to the correct adapter instance.
 */

export { AnthropicAdapter } from './anthropic.adapter';
export { BaseLLMAdapter } from './base-llm.adapter';
export { GoogleAdapter } from './google.adapter';
export { OpenAIAdapter } from './openai.adapter';
export { OpenRouterAdapter } from './openrouter.adapter';

import { ProviderType } from '../types/llm.types';
import { AnthropicAdapter } from './anthropic.adapter';
import type { BaseLLMAdapter } from './base-llm.adapter';
import { GoogleAdapter } from './google.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { OpenRouterAdapter } from './openrouter.adapter';

/**
 * Resolves the correct adapter instance based on the active config values.
 *
 * @param providerType - The ProviderType string from glyph.config
 * @param baseUrl      - The base endpoint URL (only used by local providers)
 * @param apiKey       - API key (only used by cloud providers)
 */
export function resolveAdapter(
    providerType: string,
    baseUrl: string,
    apiKey?: string,
): BaseLLMAdapter {
    switch (providerType) {
        case ProviderType.Ollama:
            return new OpenAIAdapter(apiKey || '', baseUrl || 'http://127.0.0.1:11434', 'Ollama', true);

        case ProviderType.LmStudio:
            return new OpenAIAdapter(apiKey || '', baseUrl || 'http://127.0.0.1:1234', 'LM Studio', true);

        case ProviderType.OpenAI:
            return new OpenAIAdapter(apiKey || '', baseUrl || 'https://api.openai.com', 'OpenAI', false);

        case 'Groq':
            return new OpenAIAdapter(apiKey || '', 'https://api.groq.com/openai', 'Groq', false);

        case ProviderType.Google:
        case 'Gemini':
            return new GoogleAdapter(apiKey || '');

        case ProviderType.OpenRouter:
        case 'OpenRouter':
            return new OpenRouterAdapter(apiKey || '');

        case ProviderType.Anthropic:
            return new AnthropicAdapter(apiKey || '');

        default:
            // Fallback to OpenAIAdapter assuming an OpenAI-compatible endpoint
            console.warn(
                `[AdapterResolver] Unknown providerType "${providerType}", falling back to OpenAICompatibleAdapter.`,
            );
            return new OpenAIAdapter(apiKey || '', baseUrl, 'Unknown', true);
    }
}
