import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { BaseLLMProvider } from './base.provider';

/**
 * Ollama — local provider using the OpenAI compatibility shim.
 *
 * Health:  GET /api/tags
 * Models:  GET /api/tags → models[].name
 * SDK:     createOpenAI({ baseURL: <endpoint>/v1, apiKey: 'ollama' })
 */
export class OllamaProvider extends BaseLLMProvider {
    readonly displayName = 'Ollama';
    readonly isLocal = true;

    constructor(baseUrl: string) {
        super('ollama', baseUrl);
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
            const res = await fetch(`${this.baseUrl}/api/tags`);
            return res.ok;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`);
            if (!res.ok) {
                return [];
            }
            const data = (await res.json()) as { models: { name: string }[] };
            return data.models.map((m) => m.name);
        } catch {
            return [];
        }
    }

    async getModelsForPicker() {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`);
            if (!res.ok) {
                return [];
            }
            const data = (await res.json()) as {
                models: Array<{
                    name: string;
                    size: number;
                    details?: {
                        parameter_size?: string;
                        quantization_level?: string;
                    };
                }>;
            };
            return data.models.map((m) => ({
                label: m.name,
                description: `${m.details?.parameter_size ?? ''} | ${m.details?.quantization_level ?? ''}`,
                detail: `Size: ${(m.size / 1024 ** 3).toFixed(2)} GB`,
            }));
        } catch {
            return [];
        }
    }
}
