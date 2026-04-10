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
        // Lightweight check — list models with API key as query param
        const url = `${this.baseUrl}/v1beta/models?key=${this.apiKey}`;
        const res = await fetch(url);

        if (res.ok || res.status === 429) {
            return true;
        }

        const body = await res.text().catch(() => '');
        throw new Error(`Gemini returned ${res.status}: ${body.slice(0, 200)}`);
    }

    async getModels(): Promise<string[]> {
        return this.registry.models;
    }
}
