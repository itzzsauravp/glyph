import type { ICloudRegistery } from '../types/llm.types';

export const CLOUD_REGISTERY: ICloudRegistery = {
    Gemini: {
        models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-flash-lite-preview'],
        baseUrl: 'https://generativelanguage.googleapis.com',
        chatUrl: '/v1beta/openai/chat/completions',
        completionsUrl: '/v1beta/openai/completions',
        generateUrl: '/v1beta/models/{model}:generateContent',
        helpLink: 'https://aistudio.google.com/app/apikey',
    },
    Groq: {
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
        baseUrl: 'https://api.groq.com/openai',
        chatUrl: '/v1/chat/completions',
        completionsUrl: '/v1/completions',
        generateUrl: '/v1/chat/completions',
        helpLink: 'https://console.groq.com/keys',
    },
    Anthropic: {
        models: ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
        baseUrl: 'https://api.anthropic.com',
        chatUrl: '/v1/messages',
        completionsUrl: '/v1/messages',
        generateUrl: '/v1/messages',
        helpLink: 'https://console.anthropic.com/settings/keys',
    },
    OpenRouter: {
        models: [
            "stepfun/step-3.5-flash:free",
            "nvidia/nemotron-3-super-120b-a12b:free"
        ],
        baseUrl: 'https://openrouter.ai/api/v1',
        chatUrl: '/chat/completions',
        completionsUrl: '/completions',
        generateUrl: '/chat/completions',
        helpLink: 'https://openrouter.ai/keys',
    },
};
