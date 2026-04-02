import path from 'node:path';
import type * as lancedb from '@lancedb/lancedb';
import * as vscode from 'vscode';

import type GlyphConfig from '../config/glyph.config';
import type { LLMGenerateResponse } from '../types/llm.types';
import BaseLLMService from './base-llm.service';
import type RepositoryIndexerService from './repo-indexer.service';

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
            throw new Error(`LLM API did not return embeddings. Response: ${JSON.stringify(data)}`);
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

    /**
     * Analyzes the project structure to identify which files contain relevant logic.
     * This is the "Phase 1: Discovery" step before actual code generation.
     */
    public async identifyRequiredFiles(
        userPrompt: string,
        directoryTree: string,
    ): Promise<string[]> {
        const { endpoint, model } = this.extractConfig();

        const systemPrompt = `
You are a senior software architect. 
Given a directory structure and a user's coding request, identify the specific files that likely contain the relevant logic, types, or context needed to complete the task.

RULES:
1. Return ONLY a valid JSON array of file paths.
2. Do NOT include explanations or markdown formatting.
3. Be precise: only include files that are truly necessary.
4. If the directory structure is small, you can include all relevant source files.
`;

        try {
            const response = await fetch(`${endpoint}/api/generate`, {
                method: 'POST',
                body: JSON.stringify({
                    system: systemPrompt,
                    model,
                    // We pass the tree and the user's intent here
                    prompt: `Directory Structure:\n${directoryTree}\n\nUser Request: "${userPrompt}"\n\nJSON array of required file paths:`,
                    stream: false,
                    options: {
                        temperature: 0.1, // Keep it deterministic
                        format: 'json', // If using Ollama/Gemini JSON mode
                    },
                }),
            });

            const data = (await response.json()) as LLMGenerateResponse;

            const cleanedResponse = this.extractCode(data.response);
            const fileList: string[] = JSON.parse(cleanedResponse);
            console.log('Files list is: ', fileList);
            console.log('PWD: ', process.cwd());

            return Array.isArray(fileList) ? fileList : [];
        } catch (error) {
            console.error('[Glyph]: Failed to identify required files', error);
            return [];
        }
    }

    /**
     * Full orchestration pipeline:
     *
     * 1. Parses the workspace directory tree.
     * 2. Asks the LLM which files are relevant to the user's prompt.
     * 3. Resolves relative paths → absolute vscode.Uri[].
     * 4. Indexes those files (hash-based skip for unchanged symbols).
     * 5. Performs a vector search for contextually relevant symbols.
     * 6. Generates code using the discovered context.
     *
     * @returns The generated code string from the LLM.
     */
    public async generateWithProjectContext(
        userPrompt: string,
        codeContext: string,
        languageId: string,
        repoIndexer: RepositoryIndexerService,
    ): Promise<string> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('[LLMService] No workspace folder open.');
        }

        const directoryTree = repoIndexer.parseDirectoryStructure();
        if (!directoryTree) {
            console.warn('[LLMService] Empty directory tree, falling back to direct generation.');
            return this.generateCode(userPrompt, codeContext, languageId);
        }

        const relativePaths = await this.identifyRequiredFiles(userPrompt, directoryTree);
        if (relativePaths.length === 0) {
            console.warn(
                '[LLMService] No relevant files identified, falling back to direct generation.',
            );
            return this.generateCode(userPrompt, codeContext, languageId);
        }

        const uris: vscode.Uri[] = [];
        for (const relativePath of relativePaths) {
            const absolutePath = path.resolve(workspaceRoot, relativePath);
            const uri = vscode.Uri.file(absolutePath);
            try {
                await vscode.workspace.fs.stat(uri);
                uris.push(uri);
            } catch {
                console.warn(`[LLMService] Skipping non-existent file: ${relativePath}`);
            }
        }

        if (uris.length === 0) {
            console.warn('[LLMService] None of the identified files exist, falling back.');
            return this.generateCode(userPrompt, codeContext, languageId);
        }

        console.log(`[LLMService] Indexing ${uris.length} discovered files...`);
        await repoIndexer.indexFile(uris);

        const queryVector = await this.generateEmbeddings(userPrompt);
        const results = await this.workspaceTable.search(queryVector).limit(10).toArray();

        const contextBlocks = results
            .filter((r: any) => r.text !== 'seed_marker')
            .map(
                (r: any) =>
                    `--- [FROM ${r.path}] Symbol: ${r.symbolName} (${r.text_type}) ---\n${r.text}`,
            )
            .join('\n\n');

        const { endpoint, model } = this.extractConfig();

        console.log('The context:', contextBlocks);

        const contextSection = contextBlocks
            ? `\n--- BEGIN PROJECT CONTEXT ---\nThe following symbols were retrieved from the project's codebase via vector search. These are REAL, EXISTING implementations. You MUST use them as your primary reference when generating code:\n\n${contextBlocks}\n--- END PROJECT CONTEXT ---`
            : '';

        const systemPrompt = `
You are a specialized programming assistant working inside a ${languageId} project.
You are editing a SPECIFIC CODE BLOCK inside a larger file.

CRITICAL: You have been given PROJECT CONTEXT below containing real symbols (functions, classes, types, interfaces) extracted from the project's codebase. You MUST:
- Study and USE the context to understand existing patterns, types, and APIs.
- Call existing functions/methods shown in context instead of re-implementing them.
- Follow the coding style and conventions visible in the context.
- Match existing type signatures and interfaces exactly.

RULES:
1. Return ONLY the modified code block. Nothing else.
2. Do NOT include markdown code blocks or backticks.
3. Do NOT include any imports, headers, #include, require, using, or package statements.
4. Do NOT re-implement or re-define any function, class, or type shown in the context — just call or reference them.
5. Do NOT provide explanations, comments about what changed, or usage examples.
6. If the context contains relevant helper functions, USE them.
${contextSection}
`;

        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                system: systemPrompt,
                model,
                prompt: `Instructions: ${userPrompt}\n\nCode block to modify (return ONLY the replacement for this block):\n${codeContext}`,
                stream: false,
            }),
        });

        const data = (await response.json()) as LLMGenerateResponse;
        return this.stripImports(this.extractCode(data.response));
    }
}
