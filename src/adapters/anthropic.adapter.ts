import { createAnthropic } from '@ai-sdk/anthropic';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { BaseLLMAdapter } from './base-llm.adapter';

/**
 * Anthropic — cloud adapter.
 *
 * NOTE: Anthropic does NOT support text embeddings natively.
 */
export class AnthropicAdapter extends BaseLLMAdapter {
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

    createEmbeddingModel(_embeddingModelName: string): EmbeddingModel {
        throw new Error(
            'Anthropic does not support text embeddings natively. Use a different provider for embeddings.',
        );
    }

    async isReachable(_modelName?: string): Promise<boolean> {
        try {
            // Lightweight check — list models endpoint validates auth without costing tokens
            const res = await fetch(`${this.baseUrl}/v1/models`, {
                headers: {
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                },
            });
            return res.ok || res.status === 429;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        return AnthropicAdapter.KNOWN_MODELS;
    }
}
