import { ProviderType } from '../types/llm.types';

/**
 * Returns the canonical display name for a provider type string.
 * This is the **single source of truth** for converting providerType keys
 * into human-readable names. Every part of the system that needs a display
 * name for a provider MUST use this function to prevent inconsistencies.
 */
export function getProviderDisplayName(providerType: string): string {
    switch (providerType) {
        case ProviderType.Ollama:
            return 'Ollama';
        case ProviderType.LmStudio:
            return 'LM Studio';
        case ProviderType.OpenRouter:
            return 'OpenRouter';
        case ProviderType.OpenAI:
            return 'OpenAI';
        case ProviderType.Anthropic:
            return 'Anthropic';
        case ProviderType.Google:
        case 'Gemini':
            return 'Google';
        case 'Groq':
            return 'Groq';
        default:
            return providerType || 'Unknown';
    }
}
