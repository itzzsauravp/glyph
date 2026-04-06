import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { BaseLLMProvider } from './base.provider';

/**
 * LM Studio — local provider using the OpenAI compatibility shim.
 *
 * Health:  GET /v1/models
 * Models:  GET /v1/models → data[].id
 * SDK:     createOpenAI({ baseURL: <endpoint>/v1, apiKey: 'lm-studio' })
 */
export class LmStudioProvider extends BaseLLMProvider {
    readonly displayName = 'LM Studio';
    readonly isLocal = true;

    constructor(baseUrl: string) {
        super('lm-studio', baseUrl);
    }

    createModel(modelName: string): LanguageModel {
        return createOpenAI({
            baseURL: `${this.baseUrl.replace(/\/$/, '')}/v1`,
            apiKey: this.apiKey,
        })(modelName);
    }

    createEmbeddingModel(embeddingModelName: string): EmbeddingModel {
        return createOpenAI({
            baseURL: `${this.baseUrl.replace(/\/$/, '')}/v1`,
            apiKey: this.apiKey,
        }).textEmbeddingModel(embeddingModelName);
    }

    async isReachable(): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/models`);
            return res.ok;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        try {
            const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/models`);
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
