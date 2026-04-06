import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { BaseLLMProvider } from './base.provider';

/**
 * OpenAI — cloud provider (native API).
 *
 * Health:  GET /v1/models (or 1-token ping if custom baseUrl).
 * Models:  GET /v1/models → data[].id
 * SDK:     createOpenAI({ apiKey })
 */
export class OpenAIProvider extends BaseLLMProvider {
    readonly displayName = 'OpenAI';
    readonly isLocal = false;

    constructor(apiKey: string, baseUrl?: string) {
        super(apiKey, baseUrl || 'https://api.openai.com');
    }

    createModel(modelName: string): LanguageModel {
        return createOpenAI({
            baseURL: this.baseUrl !== 'https://api.openai.com' ? `${this.baseUrl}/v1` : undefined,
            apiKey: this.apiKey,
        })(modelName);
    }

    createEmbeddingModel(embeddingModelName: string): EmbeddingModel {
        return createOpenAI({
            baseURL: this.baseUrl !== 'https://api.openai.com' ? `${this.baseUrl}/v1` : undefined,
            apiKey: this.apiKey,
        }).textEmbeddingModel(embeddingModelName);
    }

    async isReachable(): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/v1/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        try {
            const res = await fetch(`${this.baseUrl}/v1/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });
            if (!res.ok) {
                return [];
            }
            const data = (await res.json()) as { data: { id: string }[] };
            return data.data.map((m) => m.id);
        } catch {
            return [];
        }
    }
}
