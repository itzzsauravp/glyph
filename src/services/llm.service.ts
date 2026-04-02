import type * as lancedb from '@lancedb/lancedb';
import type * as vscode from 'vscode';

import type GlyphConfig from '../config/glyph.config';
import type { LLMGenerateResponse } from '../types/llm.types';
import BaseLLMService from './base-llm.service';

/**
 * Wraps the local LLM HTTP API for code generation, documentation, and embeddings.
 * Compatible with Ollama, LM Studio, and any service exposing the same REST interface.
 *
 * The service holds a reference to the workspace's LanceDB table so it can
 * perform context-aware vector searches without depending on VectorDatabaseService.
 */
export default class LLMService extends BaseLLMService {
    constructor(
        private readonly glyphConfig: GlyphConfig,
        private readonly workspaceTable: lancedb.Table,
    ) {
        super();
    }

    private extractCode(text: string): string {
        const match = text.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/);
        return match ? match[1].trim() : text.trim();
    }

    private stripImports(code: string): string {
        const importPatterns = [
            /^\s*#include\s+[<"].*[>"]\s*$/,
            /^\s*#import\s+.*$/,
            /^\s*import\s+.*$/,
            /^\s*from\s+\S+\s+import\s+.*$/,
            /^\s*require\s*\(.*\)\s*;?\s*$/,
            /^\s*using\s+[\w.]+\s*;\s*$/,
            /^\s*package\s+[\w.]+\s*;?\s*$/,
        ];

        return code
            .split('\n')
            .filter((line) => !importPatterns.some((pattern) => pattern.test(line)))
            .join('\n')
            .trim();
    }

    private extractConfig() {
        return this.glyphConfig.getExtensionConfig();
    }

    /**
     * Queries the workspace table for the top-K vector matches scoped to a
     * single file and returns them as a formatted context block.
     */
    private async retrieveFileContext(
        queryText: string,
        documentUri: vscode.Uri,
        topK: number = 5,
    ): Promise<string> {
        try {
            const queryVector = await this.generateEmbeddings(queryText);

            const results = await this.workspaceTable
                .vectorSearch(queryVector)
                .where(`path = '${documentUri.fsPath}'`)
                .limit(topK)
                .toArray();

            if (!results || results.length === 0) {
                return '';
            }

            const contextBlocks = results
                .filter((r: any) => r.text !== 'seed_marker')
                .map(
                    (r: any, _i: number) =>
                        `--- [ALREADY DEFINED IN FILE] Symbol: ${r.symbolName} (${r.text_type}) ---\n${r.text}`,
                )
                .join('\n\n');

            return contextBlocks;
        } catch (error) {
            console.warn(
                '[LocalLLMService] Context retrieval failed, proceeding without context:',
                error,
            );
            return '';
        }
    }

    public async generateEmbeddings(content: string | Array<string>): Promise<number[]> {
        const { endpoint, embeddingModel } = this.extractConfig();

        if (!embeddingModel) {
            throw new Error('No embedding model configured in Glyph settings.');
        }

        const response = await fetch(`${endpoint}/api/embed`, {
            method: 'POST',
            body: JSON.stringify({
                model: embeddingModel,
                input: content,
            }),
        });

        const data = (await response.json()) as any;

        if (data.error) {
            throw new Error(`LLM API returned an error: ${data.error}`);
        }

        if (!data.embeddings || !Array.isArray(data.embeddings) || data.embeddings.length === 0) {
            throw new Error(
                `LLM API did not return embeddings. Response: ${JSON.stringify(data)}`,
            );
        }

        return data.embeddings[0];
    }

    public async generateCode(prompt: string, code: string, languageId: string): Promise<string> {
        const { endpoint, model } = this.extractConfig();

        const systemPrompt = `
You are a specialized programming assistant.
Your task is to modify ONLY the provided code block in ${languageId} according to the instructions.

RULES:
1. Return ONLY the modified code block. Nothing else.
2. Do NOT include markdown code blocks.
3. Do NOT include any imports, headers, includes, require, or using statements.
4. Do NOT provide explanations, comments, or usage examples.
5. Do NOT re-implement functions that are called but not shown — just call them.
6. Do not include any backticks.
`;

        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                system: systemPrompt,
                model,
                prompt: `Instructions: ${prompt}\n\nCode block to modify:\n${code}`,
                stream: false,
            }),
        });

        const data = (await response.json()) as LLMGenerateResponse;
        return this.stripImports(this.extractCode(data.response));
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
5. Do not include any backticks.
6. Focus on parameters, return values, and a brief summary.
`;

        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                model,
                system: systemPrompt,
                prompt: `Code to document:\n${code}`,
                stream: false,
                options: { temperature: 0.1 },
            }),
        });

        const data = (await response.json()) as LLMGenerateResponse;
        return this.extractCode(data.response);
    }

    /**
     * Generates code with awareness of the surrounding file context.
     *
     * 1. Embeds the user prompt into a vector.
     * 2. Searches the workspace table for the most relevant symbols in the
     *    target document.
     * 3. Injects those symbols as contextual reference into the system prompt.
     */
    public async generateCodeWithContext(
        prompt: string,
        code: string,
        languageId: string,
        documentUri: vscode.Uri,
    ): Promise<string> {
        const { endpoint, model } = this.extractConfig();

        const contextBlock = await this.retrieveFileContext(prompt, documentUri);

        const contextSection = contextBlock
            ? `\nThe following symbols ALREADY EXIST in the same file. Do NOT re-define them. Just CALL them if needed:\n${contextBlock}`
            : '';

        const systemPrompt = `
You are a specialized programming assistant.
You are editing a SPECIFIC CODE BLOCK inside a larger ${languageId} file.
Return ONLY the replacement for that block.

RULES:
1. Return ONLY the modified code block. Nothing else.
2. Do NOT include markdown code blocks.
3. Do NOT include any imports, headers, #include, require, using, or package statements.
4. Do NOT re-implement or re-define functions/types shown in the context below. Just call them.
5. Do NOT provide explanations or usage examples.
6. Do not include any backticks.
${contextSection}
`;

        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                system: systemPrompt,
                model,
                prompt: `Instructions: ${prompt}\n\nCode block to modify (return ONLY the replacement for this block):\n${code}`,
                stream: false,
            }),
        });

        const data = (await response.json()) as LLMGenerateResponse;
        return this.stripImports(this.extractCode(data.response));
    }

    /**
     * Generates documentation with awareness of the surrounding file context.
     *
     * Works identically to generateDocsWithContext but enriches the system
     * prompt with related types and functions from the same file so the
     * generated docstring can reference them accurately.
     */
    public async generateDocsWithContext(
        code: string,
        languageId: string,
        documentUri: vscode.Uri,
    ): Promise<string> {
        const { endpoint, model } = this.extractConfig();

        const contextBlock = await this.retrieveFileContext(code, documentUri);

        const contextSection = contextBlock
            ? `\n\nRELEVANT CONTEXT FROM THE CURRENT FILE (use as reference for accurate documentation):\n${contextBlock}`
            : '';

        const systemPrompt = `
You are an expert technical writer and developer.
Your task is to generate ONLY the documentation comment block (Docstring) for the provided code in ${languageId}.

RULES:
1. Return ONLY the documentation comment block.
2. Use the standard "Docstring" format for ${languageId} (e.g., /** */ for TS, """ """ for Python).
3. STRICT: Do NOT return the source code itself. Do NOT return the function or class signature.
4. Do NOT include markdown code blocks (\`\`\`).
5. Do not include any backticks.
6. Focus on parameters, return values, and a brief summary.
7. STRICT: Do NOT include any imports, headers, or include statements.
8. Use the contextual information below to understand types, interfaces, and related functions that ALREADY EXIST in the file. Reference them accurately in the documentation.
${contextSection}
`;

        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                model,
                system: systemPrompt,
                prompt: `Code to document:\n${code}`,
                stream: false,
                options: { temperature: 0.1 },
            }),
        });

        const data = (await response.json()) as LLMGenerateResponse;
        return this.extractCode(data.response);
    }
}
