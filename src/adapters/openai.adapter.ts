import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { BaseLLMAdapter } from './base-llm.adapter';

/**
 * A unified adapter for ANY OpenAI-compatible API.
 * This includes: Native OpenAI, Ollama (via its /v1 shim), LM Studio, Groq, etc.
 */
export class OpenAIAdapter extends BaseLLMAdapter {
    readonly isLocal: boolean;
    readonly displayName: string;

    constructor(
        apiKey: string,
        baseUrl: string,
        displayName: string = 'OpenAI-Compatible',
        isLocal: boolean = false,
    ) {
        // Ensure baseUrl is clean
        super(apiKey, baseUrl.replace(/\/$/, ''));
        this.displayName = displayName;
        this.isLocal = isLocal;
    }

    createModel(modelName: string): LanguageModel {
        const apiUrl = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;

        const openai = createOpenAI({
            baseURL: apiUrl,
            apiKey: this.apiKey || 'dummy-key',
        });

        return openai.chat(modelName);
    }

    createEmbeddingModel(embeddingModelName: string): EmbeddingModel {
        const apiUrl = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;

        const openai = createOpenAI({
            baseURL: apiUrl,
            apiKey: this.apiKey || 'dummy-key',
        });

        return openai.embedding(embeddingModelName);
    }

    async isReachable(_modelName?: string): Promise<boolean> {
        // Prefer /api/tags for Ollama natively
        if (this.displayName === 'Ollama') {
            try {
                const ollamaBaseUrl = this.baseUrl.replace(/\/v1$/, '');
                const fallbackRes = await fetch(`${ollamaBaseUrl}/api/tags`);
                if (fallbackRes.ok) {
                    return true;
                }
            } catch (_e) {
                // Ignore and fall back to /models
            }
        }

        try {
            const apiUrl = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;
            const headerObj: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (this.apiKey) {
                headerObj.Authorization = `Bearer ${this.apiKey}`;
            }

            const res = await fetch(`${apiUrl}/models`, {
                headers: headerObj,
            });

            if (res.ok) {
                return true;
            }

            // Fallback check if /v1/models fails
            if (this.isLocal && this.displayName !== 'Ollama') {
                const localBaseUrl = this.baseUrl.replace(/\/v1$/, '');
                const fallbackRes = await fetch(`${localBaseUrl}/api/tags`);
                return fallbackRes.ok;
            }

            return false;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        // Prefer /api/tags for Ollama directly
        if (this.displayName === 'Ollama') {
            try {
                const ollamaBaseUrl = this.baseUrl.replace(/\/v1$/, '');
                const fallbackRes = await fetch(`${ollamaBaseUrl}/api/tags`);
                if (fallbackRes.ok) {
                    const data = (await fallbackRes.json()) as { models: { name: string }[] };
                    return data.models.map((m) => m.name);
                }
            } catch (_e) {
                // Ignore and fall back to /models
            }
        }

        try {
            const apiUrl = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;
            const headerObj: Record<string, string> = {};
            if (this.apiKey) {
                headerObj.Authorization = `Bearer ${this.apiKey}`;
            }

            const res = await fetch(`${apiUrl}/models`, {
                headers: headerObj,
            });

            if (res.ok) {
                const data = (await res.json()) as { data: { id: string }[] };
                return data.data.map((m) => m.id);
            }

            // Fallback if /v1/models fails (for non-Ollama local providers or if the above failed)
            if (this.isLocal && this.displayName !== 'Ollama') {
                const localBaseUrl = this.baseUrl.replace(/\/v1$/, '');
                const fallbackRes = await fetch(`${localBaseUrl}/api/tags`);
                if (fallbackRes.ok) {
                    const data = (await fallbackRes.json()) as { models: { name: string }[] };
                    return data.models.map((m) => m.name);
                }
            }

            return [];
        } catch {
            return [];
        }
    }
}
