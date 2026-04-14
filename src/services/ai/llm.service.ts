import path from 'node:path';
import * as nodeFs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import type * as lancedb from '@lancedb/lancedb';
import { embed, generateText, streamText, tool } from 'ai';
import { z } from 'zod';
import * as vscode from 'vscode';
import { resolveAdapter } from '../../adapters';
import type GlyphConfig from '../../config/glyph.config';
import type { RepositoryIndexerService } from '../index';
import { ToolRegistry } from './tools/ToolRegistry';

/**
 * Service that interfaces with large language models through the Vercel AI SDK.
 */
export default class LLMService {
    constructor(
        public readonly glyphConfig: GlyphConfig,
        public readonly workspaceTable: lancedb.Table,
    ) { }

    private toolCapabilityCache = new Map<string, boolean>();

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

    private async getLanguageModel() {
        const config = this.glyphConfig.getExtensionConfig();
        const apiKey = await this.glyphConfig.getApiKey(config.providerType);

        if (!config.model) {
            throw new Error('No target model configured in Glyph settings.');
        }

        const adapter = resolveAdapter(config.providerType, config.endpoint, apiKey);
        return adapter.createModel(config.model);
    }

    private async getEmbeddingModel() {
        const config = this.glyphConfig.getExtensionConfig();
        const apiKey = await this.glyphConfig.getApiKey(config.providerType);

        const adapter = resolveAdapter(config.providerType, config.endpoint, apiKey);

        let embeddingModelName = config.embeddingModel;

        if (!embeddingModelName) {
            switch (config.providerType) {
                case 'Ollama':
                case 'LM Studio':
                    embeddingModelName = 'nomic-embed-text';
                    break;
                case 'Google':
                    embeddingModelName = 'text-embedding-004';
                    break;
                case 'OpenAI':
                    embeddingModelName = 'text-embedding-3-small';
                    break;
                case 'OpenRouter':
                    // OpenRouter provides various embedding endpoints, nomic is popular and cheap/free.
                    embeddingModelName = 'nomic-ai/nomic-embed-text';
                    break;
                case 'Anthropic':
                    throw new Error('Anthropic does not provide native embeddings via AI SDK. Please set a custom embedding model in Glyph settings.');
                default:
                    if (adapter.isLocal) {
                        embeddingModelName = 'nomic-embed-text';
                    } else {
                        throw new Error('No embedding model configured in Glyph settings.');
                    }
            }
        }

        return adapter.createEmbeddingModel(embeddingModelName);
    }

    private handleError(error: unknown): never {
        let message = 'An unknown error occurred during LLM operation.';
        if (error instanceof Error) {
            message = error.message;

            // Handle Vercel AI SDK specific errors
            if (error.name === 'AI_NoOutputGeneratedError') {
                message =
                    'The AI model returned an empty response. This can happen if the prompt was blocked or the model failed to generate text.';
            } else if (error.name === 'AI_APICallError') {
                message = `API Call Failed: ${error.message} (Check your model configuration and API keys).`;
            }
        }

        console.error('[LLMService]', message, error instanceof Error ? error.stack : undefined);

        if (message.includes('fetch failed') || message.includes('ECONNREFUSED')) {
            throw new Error(
                'Connection Refused: Ensure your local LLM is running or your internet is active.',
            );
        } else if (message.includes('401') || message.includes('API key')) {
            throw new Error('Invalid API Key: Please check your provider API key in settings.');
        } else if (message.includes('404')) {
            throw new Error('Model Not Found: Ensure the model name exists on your provider.');
        } else if (message.includes('400')) {
            throw new Error(
                `Bad Request (400): ${message}. This often happens if the model name or parameters are invalid for the provider.`,
            );
        }

        throw new Error(`LLM Error: ${message}`);
    }

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
                .filter((r) => r.text !== 'seed_marker')
                .map(
                    (r) =>
                        `--- [ALREADY DEFINED IN FILE] Symbol: ${r.symbolName} (${r.text_type}) ---\n${r.text}`,
                )
                .join('\n\n');

            return contextBlocks;
        } catch (error) {
            console.warn(
                '[LLMService] Context retrieval failed, proceeding without context:',
                error,
            );
            return '';
        }
    }

    public async generateEmbeddings(content: string | Array<string>, abortSignal?: AbortSignal): Promise<number[]> {
        try {
            const embeddingModel = await this.getEmbeddingModel();
            const contents = Array.isArray(content) ? content : [content];

            console.log(`[LLMService] Generating embeddings for ${contents.length} blocks...`);

            const result = await embed({
                model: embeddingModel,
                value: contents.join('\n'),
                abortSignal,
            });

            return result.embedding;
        } catch (error) {
            this.handleError(error);
        }
    }

    public async generateCode(prompt: string, code: string, languageId: string): Promise<string> {
        try {
            const model = await this.getLanguageModel();
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

            console.log(
                `[LLMService] Generating code with instruction: "${prompt.substring(0, 50)}..."`,
            );

            const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: `Instructions: ${prompt}\n\nCode block to modify:\n${code}`,
            });

            console.log('[LLMService] Code generation successful.');
            return this.stripImports(this.extractCode(text));
        } catch (error) {
            this.handleError(error);
        }
    }

    public async generateDocs(code: string, languageId: string): Promise<string> {
        try {
            const model = await this.getLanguageModel();
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

            const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: `Code to document:\n${code}`,
                temperature: 0.1,
            });

            return this.extractCode(text);
        } catch (error) {
            this.handleError(error);
        }
    }

    public async generateCodeWithContext(
        prompt: string,
        code: string,
        languageId: string,
        documentUri: vscode.Uri,
    ): Promise<string> {
        try {
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

            const model = await this.getLanguageModel();
            const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: `Instructions: ${prompt}\n\nCode block to modify (return ONLY the replacement for this block):\n${code}`,
            });

            return this.stripImports(this.extractCode(text));
        } catch (error) {
            this.handleError(error);
        }
    }

    public async generateDocsWithContext(
        code: string,
        languageId: string,
        documentUri: vscode.Uri,
    ): Promise<string> {
        try {
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

            const model = await this.getLanguageModel();
            const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: `Code to document:\n${code}`,
                temperature: 0.1,
            });

            return this.extractCode(text);
        } catch (error) {
            this.handleError(error);
        }
    }

    public async identifyRequiredFiles(
        userPrompt: string,
        directoryTree: string,
    ): Promise<string[]> {
        try {
            const systemPrompt = `
You are a senior software architect. 
Given a directory structure and a user's coding request, identify the specific files that likely contain the relevant logic, types, or context needed to complete the task.

RULES:
1. Return ONLY a valid JSON array of file paths.
2. Do NOT include explanations or markdown formatting.
3. Be precise: only include files that are truly necessary.
4. If the directory structure is small, you can include all relevant source files.
`;

            const model = await this.getLanguageModel();
            const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: `Directory Structure:\n${directoryTree}\n\nUser Request: "${userPrompt}"\n\nJSON array of required file paths:`,
                temperature: 0.1,
            });

            const cleanedResponse = this.extractCode(text);
            const fileList: string[] = JSON.parse(cleanedResponse);
            return Array.isArray(fileList) ? fileList : [];
        } catch (error) {
            console.error('[Glyph]: Failed to identify required files', error);
            return [];
        }
    }

    public async generateWithProjectContext(
        userPrompt: string,
        codeContext: string,
        languageId: string,
        repoIndexer: RepositoryIndexerService,
    ): Promise<string> {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                throw new Error('[LLMService] No workspace folder open.');
            }

            const directoryTree = repoIndexer.parseDirectoryStructure();
            if (!directoryTree) {
                return this.generateCode(userPrompt, codeContext, languageId);
            }

            const relativePaths = await this.identifyRequiredFiles(userPrompt, directoryTree);
            if (relativePaths.length === 0) {
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
                return this.generateCode(userPrompt, codeContext, languageId);
            }

            await repoIndexer.indexFile(uris);

            const queryVector = await this.generateEmbeddings(userPrompt);
            const results = await this.workspaceTable.search(queryVector).limit(10).toArray();

            const contextBlocks = results
                .filter((r) => r.text !== 'seed_marker')
                .map(
                    (r) =>
                        `--- [FROM ${r.path}] Symbol: ${r.symbolName} (${r.text_type}) ---\n${r.text}`,
                )
                .join('\n\n');

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

            const model = await this.getLanguageModel();
            const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: `Instructions: ${userPrompt}\n\nCode block to modify (return ONLY the replacement for this block):\n${codeContext}`,
            });

            return this.stripImports(this.extractCode(text));
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Checks if the current model supports tool calling by making a lightweight
     * test request with a dummy tool. Results are cached per model.
     */
    public async testToolCallSupport(): Promise<boolean> {
        try {
            const config = this.glyphConfig.getExtensionConfig();
            const cacheKey = `${config.providerType}::${config.model}`;

            if (this.toolCapabilityCache.has(cacheKey)) {
                const cached = this.toolCapabilityCache.get(cacheKey)!;
                console.log(`[LLMService] Tool capability (cached): ${cached} for ${cacheKey}`);
                return cached;
            }

            const model = await this.getLanguageModel();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (generateText as any)({
                model,
                messages: [{ role: 'user', content: 'Say ok' }],
                tools: {
                    ping: {
                        description: 'Used for capability testing',
                        parameters: z.object({ ok: z.boolean().optional() }),
                        execute: async () => 'pong',
                    },
                },
                maxSteps: 1,
            });

            this.toolCapabilityCache.set(cacheKey, true);
            console.log(`[LLMService] Tool capability: SUPPORTED for ${cacheKey}`);
            return true;
        } catch (error) {
            const msg = String(error);
            const isUnsupported =
                msg.includes('tool') || msg.includes('function') || msg.includes('400');
            console.warn('[LLMService] Tool call test failed:', msg);
            const result = !isUnsupported;

            const config = this.glyphConfig.getExtensionConfig();
            const cacheKey = `${config.providerType}::${config.model}`;
            this.toolCapabilityCache.set(cacheKey, result);

            return result;
        }
    }

    /**
     * Clears the cached tool capability results.
     * Call this when the model or provider changes.
     */
    public clearToolCapabilityCache(): void {
        this.toolCapabilityCache.clear();
    }

    /**
     * Generates code using tool-based context gathering instead of RAG.
     * The model uses read-only tools to explore the codebase, then generates code.
     */
    public async generateCodeWithTools(
        prompt: string,
        code: string,
        languageId: string,
        workspaceRoot: string,
    ): Promise<string> {
        try {
            const model = await this.getLanguageModel();
            const registry = new ToolRegistry(workspaceRoot);
            const readTools = registry.getReadOnlyTools();

            const systemPrompt = `
You are a specialized programming assistant with access to the project's codebase via tools.
Your task is to modify ONLY the provided code block in ${languageId} according to the instructions.

WORKFLOW:
1. FIRST, use the available tools to understand the project structure and read relevant files for context.
2. THEN, generate the modified code based on what you learned.

RULES:
1. Return ONLY the modified code block as your final answer. Nothing else.
2. Do NOT include markdown code blocks.
3. Do NOT include any imports, headers, includes, require, or using statements.
4. Do NOT re-implement functions that are called but not shown — just call them.
5. Do NOT provide explanations, comments, or usage examples.
6. Do not include any backticks.
`;

            console.log(`[LLMService] Generating code with tools: "${prompt.substring(0, 50)}..."`);

            const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: `Instructions: ${prompt}\n\nCode block to modify:\n${code}`,
                tools: readTools,
                maxSteps: 6,
            });

            console.log('[LLMService] Code generation with tools successful.');
            return this.stripImports(this.extractCode(text));
        } catch (error) {
            this.handleError(error);
        }
    }

    /**
     * Executes a brainstorming session (chat) with streaming chunks yielded via callback.
     */
    public async executeChatStream(
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
        onChunk: (chunk: string) => void,
        abortSignal?: AbortSignal,
        options?: {
            toolsEnabled?: boolean;
            workspaceRoot?: string;
            onActivity?: (activity: string) => void;
            onRequestPermission?: (toolName: string, details: string) => Promise<boolean>;
        },
    ): Promise<string> {
        try {
            const model = await this.getLanguageModel();
            console.log('[LLMService] Starting chat stream...');

            let streamError: Error | undefined;

            // Build codebase tools when toolsEnabled is requested
            const workspaceRoot = options?.workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const onActivity = options?.onActivity;
            const onRequestPermission = options?.onRequestPermission;
            const toolsEnabled = options?.toolsEnabled ?? false;

            const registry = new ToolRegistry(workspaceRoot, onRequestPermission);
            const codebookTools: any = toolsEnabled ? registry.getTools() : undefined;

            const result = streamText({
                model,
                messages,
                abortSignal,
                ...(codebookTools ? { tools: codebookTools, maxSteps: 6 } : {}),
                onError({ error }) {
                    console.error('[LLMService] Stream error:', error);
                    streamError = error instanceof Error ? error : new Error(String(error));
                },
                onStepFinish(step) {
                    if (step.toolCalls && step.toolCalls.length > 0 && onActivity) {
                        const toolCallAny = step.toolCalls[0] as any;
                        const toolName = toolCallAny?.toolName ?? 'tool';
                        const friendlyNames: Record<string, string> = {
                            list_project_structure: '🗂️ Listing project structure...',
                            read_file_content: `📖 Reading ${toolCallAny?.args?.relativePath ?? 'file'}...`,
                            read_lines: `📖 Reading lines ${toolCallAny?.args?.relativePath ?? 'from file'}...`,
                            search_codebase: `🔍 Searching: "${toolCallAny?.args?.query ?? '...'}"`,
                            grep_search: `🔍 Grep: "${toolCallAny?.args?.regexPattern ?? '...'}"`,
                            list_workspace_files: '📁 Listing workspace files...',
                            create_file: `📝 Creating ${toolCallAny?.args?.relativePath ?? 'file'}...`,
                            edit_file: `💾 Updating ${toolCallAny?.args?.relativePath ?? 'file'}...`,
                            run_command: `💻 Running command...`,
                        };
                        onActivity(friendlyNames[toolName] ?? `⚙️ Running ${toolName}...`);
                    }
                },
            });

            let chunkCount = 0;
            let reasoningStarted = false;
            let fullText = '';

            for await (const part of result.fullStream) {
                const partAny = part as any;
                if (part.type === 'text-delta') {
                    if (reasoningStarted) {
                        onChunk('</think>\n\n');
                        fullText += '</think>\n\n';
                        reasoningStarted = false;
                    }
                    chunkCount++;
                    const chunkInfo = partAny.textDelta || partAny.text || '';
                    onChunk(chunkInfo);
                    fullText += chunkInfo;
                } else if (part.type === 'reasoning-delta' || part.type === 'reasoning-start') {
                    if (!reasoningStarted) {
                        onChunk('<think>\n');
                        fullText += '<think>\n';
                        reasoningStarted = true;
                    }
                    if (part.type === 'reasoning-delta') {
                        chunkCount++;
                        const chunkInfo = partAny.textDelta || partAny.reasoning || partAny.delta || '';
                        onChunk(chunkInfo);
                        fullText += chunkInfo;
                    }
                } else if (part.type === 'tool-call') {
                    const argStr = JSON.stringify(partAny.args || {}, null, 2);
                    const chunkInfo = `\n<details class="tool-block"><summary>🛠️ Executing: ${partAny.toolName}</summary>\n\n\`\`\`json\n${argStr}\n\`\`\`\n\n</details>\n`;
                    onChunk(chunkInfo);
                    fullText += chunkInfo;
                } else if (part.type === 'tool-result') {
                    const resStr = typeof partAny.result === 'string' ? partAny.result : JSON.stringify(partAny.result || {}, null, 2);
                    const chunkInfo = `\n<details class="tool-block"><summary>✅ Result: ${partAny.toolName}</summary>\n\n\`\`\`text\n${resStr.slice(0, 1000)}${resStr.length > 1000 ? '...\n(truncated)' : ''}\n\`\`\`\n\n</details>\n`;
                    onChunk(chunkInfo);
                    fullText += chunkInfo;
                }
            }

            if (reasoningStarted) {
                onChunk('</think>\n\n');
                fullText += '</think>\n\n';
            }

            console.log(`[LLMService] Chat stream completed with ${chunkCount} chunks.`);

            // If an error was captured during streaming, throw it now
            if (streamError) {
                throw streamError;
            }

            if (!fullText && chunkCount === 0) {
                throw new Error(
                    'The AI model returned an empty response. Check your API key, model name, and provider connectivity.',
                );
            }

            return fullText;
        } catch (error) {
            this.handleError(error);
        }
    }
}
