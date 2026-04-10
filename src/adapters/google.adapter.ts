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

    async isReachable(_modelName?: string): Promise<boolean> {
        try {
            // Lightweight check — list models with API key as query param
            const url = `${this.baseUrl}/v1beta/models?key=${this.apiKey}`;
            const res = await fetch(url);
            return res.ok || res.status === 429;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        return this.registry.models;
    }
}
