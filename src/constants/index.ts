import type { ICloudRegistery } from '../types/llm.types';

export const CLOUD_REGISTERY: ICloudRegistery = {
    Gemini: {
        models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-flash-lite-preview'],
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        helpLink: 'https://aistudio.google.com/app/apikey',
    },
    Groq: {
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
        baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
        helpLink: 'https://console.groq.com/keys',
    },
    OpenRouter: {
        models: ['google/gemini-2.0-flash-001:free', 'mistralai/mistral-7b-instruct:free'],
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        helpLink: 'https://openrouter.ai/keys',
    },
};
