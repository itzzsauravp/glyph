import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { CLOUD_REGISTERY } from '../constants';
import { BaseLLMAdapter } from './base-llm.adapter';

/**
 * OpenRouter — cloud adapter (OpenAI-compatible API).
 *
 * Health:  1-token chat completion via the registry's chatUrl.
 * Models:  Static list from CLOUD_REGISTERY['OpenRouter'].
 */
export class OpenRouterAdapter extends BaseLLMAdapter {
    readonly displayName = 'OpenRouter';
    readonly isLocal = false;

    private readonly registry = CLOUD_REGISTERY.OpenRouter;

    constructor(apiKey: string) {
        super(apiKey, CLOUD_REGISTERY.OpenRouter.baseUrl);
    }

    createModel(modelName: string): LanguageModel {
        const openai = createOpenAI({
            baseURL: this.baseUrl,
            apiKey: this.apiKey,
        });
        return openai.chat(modelName);
    }

    createEmbeddingModel(embeddingModelName: string): EmbeddingModel {
        const openai = createOpenAI({
            baseURL: this.baseUrl,
            apiKey: this.apiKey,
        });
        return openai.embedding(embeddingModelName);
    }

    async isReachable(_modelName?: string): Promise<boolean> {
        // Lightweight check — /models endpoint validates connectivity
        const res = await fetch(`${this.baseUrl}/models`, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'HTTP-Referer': 'https://github.com/itzzsauravp/glyph',
                'X-Title': 'Glyph',
            },
        });

        if (res.ok || res.status === 429) {
            return true;
        }

        const body = await res.text().catch(() => '');
        throw new Error(`OpenRouter returned ${res.status}: ${body.slice(0, 200)}`);
    }

    async getModels(): Promise<string[]> {
        return this.registry.models;
    }
}
