import type { LanguageModel } from 'ai';
import { type BaseLLMProvider, resolveProvider } from '../providers';

/**
 * Thin wrapper around `resolveProvider()`.
 *
 * Kept for backward-compatibility; all real logic now lives
 * in the individual provider classes under `src/providers/`.
 */
export const ProviderFactory = {
    getProvider(
        providerType: string,
        baseUrl: string,
        apiKey?: string,
    ): BaseLLMProvider {
        return resolveProvider(providerType, baseUrl, apiKey);
    },

    /** Convenience — create a LanguageModel in one call. */
    createModel(
        providerType: string,
        modelName: string,
        baseUrl: string,
        apiKey?: string,
    ): LanguageModel {
        return resolveProvider(providerType, baseUrl, apiKey).createModel(modelName);
    },

    /** Convenience — create an EmbeddingModel in one call. */
    createEmbeddingModel(
        providerType: string,
        embeddingModelName: string,
        baseUrl: string,
        apiKey?: string,
    ) {
        return resolveProvider(providerType, baseUrl, apiKey).createEmbeddingModel(
            embeddingModelName,
        );
    },
};
