import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { CLOUD_REGISTERY } from '../constants';
import { BaseLLMProvider } from './base.provider';

/**
 * OpenRouter — cloud provider (OpenAI-compatible API).
 *
 * Health:  1-token chat completion via the registry's chatUrl.
 * Models:  Static list from CLOUD_REGISTERY['OpenRouter'].
 * SDK:     createOpenAI({ baseURL: 'https://openrouter.ai/api/v1' })
 */
export class OpenRouterProvider extends BaseLLMProvider {
    readonly displayName = 'OpenRouter';
    readonly isLocal = false;

    private readonly registry = CLOUD_REGISTERY.OpenRouter;

    constructor(apiKey: string) {
        super(apiKey, CLOUD_REGISTERY.OpenRouter.baseUrl);
    }

    createModel(modelName: string): LanguageModel {
        return createOpenAI({
            baseURL: this.baseUrl,
            apiKey: this.apiKey,
        })(modelName);
    }

    createEmbeddingModel(embeddingModelName: string): EmbeddingModel {
        return createOpenAI({
            baseURL: this.baseUrl,
            apiKey: this.apiKey,
        }).textEmbeddingModel(embeddingModelName);
    }

    async isReachable(modelName?: string): Promise<boolean> {
        try {
            const model = modelName || this.registry.models[0];
            const url = `${this.baseUrl}${this.registry.chatUrl}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
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
        return this.registry.models;
    }
}
