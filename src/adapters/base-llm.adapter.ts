import type { EmbeddingModel, LanguageModel } from 'ai';

/**
 * Abstract base class for all LLM adapters.
 *
 * Each concrete adapter implements
 * its own model creation, health-checking, and model-listing logic,
 * encapsulating the provider-specific URL paths and API quirks.
 */
export abstract class BaseLLMAdapter {
    constructor(
        protected readonly apiKey: string,
        protected readonly baseUrl: string,
    ) {}

    /** Human-readable provider name (e.g. "OpenAI", "Gemini", "Ollama"). */
    abstract readonly displayName: string;

    /** Whether this adapter connects to a local LLM API. */
    abstract readonly isLocal: boolean;

    /**
     * Instantiate a Vercel AI SDK LanguageModel for chat / generation.
     */
    abstract createModel(modelName: string): LanguageModel;

    /**
     * Instantiate a Vercel AI SDK EmbeddingModel.
     * Not every provider supports embeddings — throw if unsupported.
     */
    abstract createEmbeddingModel(embeddingModelName: string): EmbeddingModel;

    /**
     * Return `true` when the provider is reachable.
     */
    abstract isReachable(modelName?: string): Promise<boolean>;

    /**
     * List the model names the user can pick from.
     */
    abstract getModels(): Promise<string[]>;

    /**
     * Rich picker items (label + detail) for the VS Code QuickPick UI.
     * By default falls back to plain labels built from `getModels()`.
     */
    async getModelsForPicker(): Promise<
        Array<{ label: string; description?: string; detail?: string }>
    > {
        const models = await this.getModels();
        return models.map((m) => ({ label: m }));
    }
}
