import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { BaseLLMProvider } from './base.provider';

/**
 * Anthropic — cloud provider (native SDK).
 *
 * Health:  1-token message via the Messages API.
 * Models:  Static shortlist (Anthropic doesn't expose a listing endpoint).
 * SDK:     createAnthropic({ apiKey })
 *
 * NOTE: Anthropic does NOT support text embeddings natively.
 */
export class AnthropicProvider extends BaseLLMProvider {
    readonly displayName = 'Anthropic';
    readonly isLocal = false;

    private static readonly KNOWN_MODELS = [
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-20241022',
        'claude-3-haiku-20240307',
    ];

    constructor(apiKey: string) {
        super(apiKey, 'https://api.anthropic.com');
    }

    createModel(modelName: string): LanguageModel {
        return createAnthropic({
            apiKey: this.apiKey,
        })(modelName);
    }

    createEmbeddingModel(_embeddingModelName: string): never {
        throw new Error(
            'Anthropic does not support text embeddings natively. Use a different provider for embeddings.',
        );
    }

    async isReachable(modelName?: string): Promise<boolean> {
        try {
            const model = modelName || AnthropicProvider.KNOWN_MODELS[0];
            const res = await fetch(`${this.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1,
                }),
            });
            return res.ok || res.status === 429;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        return AnthropicProvider.KNOWN_MODELS;
    }
}
