import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { CLOUD_REGISTERY } from '../constants';
import { BaseLLMAdapter } from './base-llm.adapter';

/**
 * Google / Gemini — cloud adapter.
 */
export class GoogleAdapter extends BaseLLMAdapter {
    readonly displayName = 'Gemini';
    readonly isLocal = false;

    private readonly registry = CLOUD_REGISTERY.Gemini;

    constructor(apiKey: string) {
        super(apiKey, CLOUD_REGISTERY.Gemini.baseUrl);
    }

    createModel(modelName: string): LanguageModel {
        return createGoogleGenerativeAI({
            apiKey: this.apiKey,
        })(modelName);
    }

    createEmbeddingModel(embeddingModelName: string): EmbeddingModel {
        return createGoogleGenerativeAI({
            apiKey: this.apiKey,
        }).embeddingModel(embeddingModelName);
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
