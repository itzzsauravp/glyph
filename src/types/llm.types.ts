export interface LLMEmbedResponse {
    model: string;
    embeddings: number[][];
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
}

export interface LLMGenerateResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    done_reason?: string;
    context?: number[];
    total_duration: number;
    load_duration: number;
    prompt_eval_count: number;
    prompt_eval_duration: number;
    eval_count: number;
    eval_duration: number;
}

export interface CloudRegisteryEntry {
    models: Array<string>;
    baseUrl: string;
    helpLink: string;
}

export type ICloudRegistery = Record<string, CloudRegisteryEntry>