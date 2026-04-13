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

/**
 * Service that interfaces with large language models through the Vercel AI SDK.
 */
export default class LLMService {
    constructor(
        public readonly glyphConfig: GlyphConfig,
        public readonly workspaceTable: lancedb.Table,
    ) {}

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
     * test request with a dummy tool.
     */
    public async testToolCallSupport(): Promise<boolean> {
        try {
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
            return true;
        } catch (error) {
            const msg = String(error);
            const isUnsupported =
                msg.includes('tool') || msg.includes('function') || msg.includes('400');
            console.warn('[LLMService] Tool call test failed:', msg);
            return !isUnsupported;
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

            const listStructureParams = z.object({
                depth: z.number().optional().describe('Max folder depth to show (default: 3)'),
            });
            const readFileParams = z.object({
                relativePath: z.string().describe('The relative path of the file from the workspace root'),
            });
            const searchParams = z.object({
                query: z.string().describe('The exact keyword or pattern to search for'),
                fileGlob: z.string().optional().describe('Optional glob to narrow search (e.g. **/*.ts)'),
            });
            const listFilesParams = z.object({
                glob: z.string().optional().describe('Glob pattern (default: **/*.ts)'),
            });
            
            // New Agentic Write/Exec Tool Schemas
            const createFileParams = z.object({
                relativePath: z.string().describe('Path where the new file should be created'),
                content: z.string().describe('The complete source code or content to write to the file'),
            });
            const editFileParams = z.object({
                relativePath: z.string().describe('Path of the existing file to edit'),
                content: z.string().describe('The complete new content that will overwrite the entire file'),
            });
            const runCommandParams = z.object({
                command: z.string().describe('The terminal command to run (e.g., "npm install", "git status")'),
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const codebookTools: any = toolsEnabled
                ? {
                    list_project_structure: {
                        description: 'Returns the directory tree of the workspace.',
                        parameters: listStructureParams,
                        execute: async (args: z.infer<typeof listStructureParams>) => {
                            const { tree } = await import('tree-node-cli');
                            return tree(workspaceRoot, {
                                allFiles: true,
                                exclude: [/node_modules/, /\.git/, /\.glyph/, /dist/, /out/],
                                maxDepth: args.depth ?? 3,
                                trailingSlash: true,
                            });
                        },
                    },
                    read_file_content: {
                        description: 'Reads the full source content of a specific file in the workspace.',
                        parameters: readFileParams,
                        execute: async (args: z.infer<typeof readFileParams>) => {
                            try {
                                const absPath = path.resolve(workspaceRoot, args.relativePath);
                                const content = nodeFs.readFileSync(absPath, 'utf-8');
                                return content.slice(0, 20000);
                            } catch {
                                return `Error: Could not read file "${args.relativePath}".`;
                            }
                        },
                    },
                    search_codebase: {
                        description: 'Performs a keyword text search across all source files. Returns matching lines with file paths.',
                        parameters: searchParams,
                        execute: async (args: z.infer<typeof searchParams>) => {
                            try {
                                const pattern = args.fileGlob ?? '**/*.{ts,js,py,go,rs,java,md}';
                                const uris = await vscode.workspace.findFiles(pattern, '{node_modules,dist,.git}/**', 200);
                                const results: string[] = [];
                                for (const uri of uris) {
                                    const doc = await vscode.workspace.openTextDocument(uri);
                                    const rel = path.relative(workspaceRoot, uri.fsPath);
                                    doc.getText().split('\n').forEach((line: string, i: number) => {
                                        if (line.toLowerCase().includes(args.query.toLowerCase())) {
                                            results.push(`${rel}:${i + 1}: ${line.trim()}`);
                                        }
                                    });
                                    if (results.length > 100) break;
                                }
                                return results.length > 0
                                    ? results.join('\n')
                                    : `No matches found for "${args.query}"`;
                            } catch (e) {
                                return `Search error: ${String(e)}`;
                            }
                        },
                    },
                    list_workspace_files: {
                        description: 'Lists all file paths in the workspace matching a glob pattern.',
                        parameters: listFilesParams,
                        execute: async (args: z.infer<typeof listFilesParams>) => {
                            const pattern = args.glob ?? '**/*.{ts,js,py,go,rs,java,md,json}';
                            const uris = await vscode.workspace.findFiles(pattern, '{node_modules,dist,.git}/**', 300);
                            return uris.map((u: vscode.Uri) => path.relative(workspaceRoot, u.fsPath)).join('\n');
                        },
                    },
                    create_file: {
                        description: 'Creates a new file with the specified content. Requires user permission.',
                        parameters: createFileParams,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        execute: async (args: any) => {
                            try {
                                const relPath = args.relativePath || args.fileName || args.path || args.file;
                                const content = args.content || args.code || args.source || '';
                                
                                if (!relPath) return 'Error: The LLM failed to provide a valid relative path.';
                                if (!onRequestPermission) return 'Error: Permission system unavailable.';
                                
                                const approved = await onRequestPermission('create_file', `Create: ${relPath}`);
                                if (!approved) return `User denied permission to create ${relPath}.`;
                                
                                const absPath = path.resolve(workspaceRoot, relPath);
                                const dir = path.dirname(absPath);
                                if (!nodeFs.existsSync(dir)) {
                                    nodeFs.mkdirSync(dir, { recursive: true });
                                }
                                nodeFs.writeFileSync(absPath, content, 'utf-8');
                                return `Successfully created file ${relPath}`;
                            } catch (e) {
                                return `Error creating file: ${String(e)}`;
                            }
                        },
                    },
                    edit_file: {
                        description: 'Overwrites an existing file with new content. Requires user permission.',
                        parameters: editFileParams,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        execute: async (args: any) => {
                            try {
                                const relPath = args.relativePath || args.fileName || args.path || args.file;
                                const content = args.content || args.code || args.source || '';

                                if (!relPath) return 'Error: The LLM failed to provide a valid relative path.';
                                if (!onRequestPermission) return 'Error: Permission system unavailable.';
                                
                                const approved = await onRequestPermission('edit_file', `Edit: ${relPath}`);
                                if (!approved) return `User denied permission to edit ${relPath}.`;

                                const absPath = path.resolve(workspaceRoot, relPath);
                                if (!nodeFs.existsSync(absPath)) return `Error: File ${relPath} does not exist. Use create_file instead.`;
                                nodeFs.writeFileSync(absPath, content, 'utf-8');
                                return `Successfully updated file ${relPath}`;
                            } catch (e) {
                                return `Error editing file: ${String(e)}`;
                            }
                        },
                    },
                    run_command: {
                        description: 'Runs a terminal command in the workspace. Requires user permission.',
                        parameters: runCommandParams,
                        execute: async (args: z.infer<typeof runCommandParams>) => {
                            try {
                                if (!onRequestPermission) return 'Error: Permission system unavailable.';
                                const approved = await onRequestPermission('run_command', `Terminal: ${args.command}`);
                                if (!approved) return `User denied permission to run command: ${args.command}`;

                                const { stdout, stderr } = await execAsync(args.command, { cwd: workspaceRoot });
                                const output = [];
                                if (stdout) output.push(`STDOUT:\n${stdout.slice(0, 10000)}`);
                                if (stderr) output.push(`STDERR:\n${stderr.slice(0, 10000)}`);
                                return output.length > 0 ? output.join('\n') : 'Command executed successfully with no output.';
                            } catch (e) {
                                return `Command failed: ${String(e)}`;
                            }
                        },
                    },
                }
                : undefined;

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
                        const toolName = step.toolCalls[0]?.toolName ?? 'tool';
                        const friendlyNames: Record<string, string> = {
                            list_project_structure: '🗂️ Listing project structure...',
                            read_file_content: `📖 Reading ${(step.toolCalls[0] as any)?.args?.relativePath ?? 'file'}...`,
                            search_codebase: `🔍 Searching: "${(step.toolCalls[0] as any)?.args?.query ?? '...'}"`,
                            list_workspace_files: '📁 Listing workspace files...',
                            create_file: `📝 Creating ${(step.toolCalls[0] as any)?.args?.relativePath ?? 'file'}...`,
                            edit_file: `💾 Updating ${(step.toolCalls[0] as any)?.args?.relativePath ?? 'file'}...`,
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
