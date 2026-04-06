export interface LlmConfig {
    model: string;
    endpoint: string;
    autoSave: boolean;
    embeddingModel: string;
    usingCloudOrchestrator: boolean;
    providerType: string;
}

export enum ProviderType {
    Ollama = 'Ollama',
    LmStudio = 'LM Studio',
    OpenRouter = 'OpenRouter',
    OpenAI = 'OpenAI',
    Anthropic = 'Anthropic',
    Google = 'Google',
}

export interface CloudRegisteryEntry {
    models: Array<string>;
    baseUrl: string;
    chatUrl: string;
    completionsUrl: string;
    generateUrl: string;
    helpLink: string;
}

export type ICloudRegistery = Record<string, CloudRegisteryEntry>;
