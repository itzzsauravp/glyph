import type { LanguageModel } from 'ai';

/**
 * Abstract base class for all LLM providers.
 *
 * Each concrete provider (Ollama, Gemini, Groq, etc.) implements
 * its own model creation, health-checking, and model-listing logic,
 * encapsulating the provider-specific URL paths and API quirks.
 */
export abstract class BaseLLMProvider {
    constructor(
        protected readonly apiKey: string,
        protected readonly baseUrl: string,
    ) {}

    /** Human-readable provider name (e.g. "Ollama", "Gemini"). */
    abstract readonly displayName: string;

    /** Whether this provider runs locally (affects health-check strategy). */
    abstract readonly isLocal: boolean;

    /**
     * Instantiate a Vercel AI SDK LanguageModel for chat / generation.
     */
    abstract createModel(modelName: string): LanguageModel;

    /**
     * Instantiate a Vercel AI SDK EmbeddingModel.
    abstract createEmbeddingModel(embeddingModelName: string): unknown;

    /**
     * Return `true` when the provider is reachable.
     * Local providers hit a health endpoint; cloud providers do a 1-token ping.
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
