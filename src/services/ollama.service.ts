import GlyphConfig from "../config/glyph.config";
import { OllamaEmbedResponse, OllamaGenerateResponse } from "../types/ollama.types";
import LLMService from "./base-llm.service";

export default class OllamaService extends LLMService {

    constructor(private readonly glyphConfig: GlyphConfig) {
        super();
    }

    private extractCode(text: string): string {
        const match = text.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/);
        return match ? match[1].trim() : text.trim();
    }

    private extractConfig() {
        return this.glyphConfig.getExtensionConfig()
    }

    public async generateEmbeddings(content: string | Array<string>) {
        const { endpoint, embeddingModel } = this.extractConfig();
        
        if (!embeddingModel) {
            throw new Error("No embedding model configured in Glyph settings.");
        }

        const response = await fetch(`${endpoint}/api/embed`, {
            method: 'POST',
            body: JSON.stringify({
                model: embeddingModel,
                input: content
            })
        });
        
        const data = await response.json() as any;
        
        if (data.error) {
            throw new Error(`Ollama API returned an error: ${data.error}`);
        }
        
        if (!data.embeddings || !Array.isArray(data.embeddings) || data.embeddings.length === 0) {
            throw new Error(`Ollama API did not return embeddings. Response: ${JSON.stringify(data)}`);
        }
        
        const vector = data.embeddings[0];
        return vector;
    }

    public async generateCode(prompt: string, code: string, languageId: string): Promise<string> {
        const { endpoint, model } = this.extractConfig()
        const systemPrompt = `
        You are a specialized programming assistant. 
        Your task is to modify the provided code in ${languageId} according to the instructions.
        RULES:
        1. Return ONLY the functional code.
        2. Do NOT include markdown code blocks (no \`\`\` or \`\`\`typescript).
        3. Do NOT provide explanations, comments, or usage examples.
        4. If the instruction is 'Refactor', return the full refactored code.
        5. Do not include any backtiks.
    `;
        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                system: systemPrompt,
                model,
                prompt: `Instructions: ${prompt}\n\nCode to modify:\n${code}`,
                stream: false
            })
        });
        const data = await response.json() as OllamaGenerateResponse;
        return this.extractCode(data.response);
    }

    public async generateDocs(code: string, languageId: string): Promise<string> {
        const { endpoint, model } = this.extractConfig();

        const systemPrompt = `
        You are an expert technical writer and developer.
        Your task is to generate ONLY the documentation comment block (Docstring) for the provided code in ${languageId}.
        
        RULES:
        1. Return ONLY the documentation comment block.
        2. Use the standard "Docstring" format for ${languageId} (e.g., /** */ for TS, """ """ for Python).
        3. STRICT: Do NOT return the source code itself. Do NOT return the function or class signature.
        4. Do NOT include markdown code blocks (\`\`\`).
        5. Do not include any backtiks.
        6. Focus on parameters, return values, and a brief summary.
    `;

        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                model,
                system: systemPrompt,
                prompt: `Code to document:\n${code}`,
                stream: false,
                options: {
                    temperature: 0.1
                }
            })
        });

        const data = await response.json() as OllamaGenerateResponse;
        return this.extractCode(data.response);
    }

}