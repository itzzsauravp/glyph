import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { CLOUD_REGISTERY } from '../constants';
import { BaseLLMProvider } from './base.provider';

/**
 * Groq — cloud provider (OpenAI-compatible API).
 *
 * Health:  1-token chat completion via the registry's chatUrl.
 * Models:  Static list from CLOUD_REGISTERY['Groq'].
 * SDK:     createOpenAI({ baseURL: <groq-base>/v1 })
 */
export class GroqProvider extends BaseLLMProvider {
    readonly displayName = 'Groq';
    readonly isLocal = false;

    private readonly registry = CLOUD_REGISTERY.Groq;

    constructor(apiKey: string) {
        super(apiKey, CLOUD_REGISTERY.Groq.baseUrl);
    }

    createModel(modelName: string): LanguageModel {
        return createOpenAI({
            baseURL: `${this.baseUrl}/v1`,
            apiKey: this.apiKey,
        })(modelName);
    }

    createEmbeddingModel(embeddingModelName: string) {
        return createOpenAI({
            baseURL: `${this.baseUrl}/v1`,
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
