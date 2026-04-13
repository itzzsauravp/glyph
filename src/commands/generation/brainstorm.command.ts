import * as fs from 'node:fs';
import * as path from 'node:path';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import type GlyphConfig from '../../config/glyph.config';
import type { LLMService, ModelRegistryService } from '../../services';
import BaseCommand from '../core/base.command';

/**
 * Brainstorm — interactive AI chat panel in a Webview Tab.
 */
export default class Brainstorm extends BaseCommand implements vscode.WebviewPanelSerializer {
    public readonly id = 'glyph.brainstorm';
    public static readonly viewType = 'glyphBrainstorm';

    private currentPanel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];
    private chatHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    private md: MarkdownIt;
    private activeAbortController: AbortController | null = null;
    private permissionPromises = new Map<string, (approved: boolean) => void>();
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    private static readonly SESSION_STATE_KEY = 'glyph.brainstorm.sessionOpen';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly glyphConfig: GlyphConfig,
        private readonly llmService: LLMService,
        private readonly modelRegistry: ModelRegistryService,
        private readonly repositoryIndexer: {
            indexFile(uris: vscode.Uri | vscode.Uri[]): Promise<void>;
            parseDirectoryStructure(): string | undefined;
        },
    ) {
        super();
        this.md = this.initializeMarkdown();

        // Subscribe to config changes — push model updates to open panels.
        // Uses debounced refresh to handle the race condition where switchToModel
        // fires model/endpoint/providerType change events sequentially.
        this.glyphConfig.onDidChange((e) => {
            if (!this.currentPanel) {
                return;
            }

            if (e.key === 'model' && typeof e.value === 'string') {
                this.currentPanel.webview.postMessage({
                    type: 'set-model-name',
                    value: e.value,
                });
            }

            // Debounce the full model list refresh so the three rapid config
            // updates from switchToModel coalesce into a single refresh.
            if (e.key === 'model' || e.key === 'providerType' || e.key === 'endpoint') {
                this.debouncedModelRefresh();
            }
        });
    }

    /**
     * Launch/Focus the Brainstorm chat panel.
     */
    public action = (): void => {
        // If panel exists, focus it
        if (this.currentPanel) {
            this.currentPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            Brainstorm.viewType,
            'Brainstorm',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview', 'brainstorm')),
                ],
            },
        );

        this.attachPanel(panel);
    };

    /**
     * Restore session from VS Code state (serialization context).
     */
    public async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, _state: any) {
        this.attachPanel(webviewPanel);
    }

    /**
     * Internal setup for a revealed or restored panel.
     */
    private attachPanel(panel: vscode.WebviewPanel) {
        this.currentPanel = panel;

        // Set icon
        panel.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, 'images', 'brain.svg'));

        // Handle focus/visibility
        this.updatePresence(true);

        panel.webview.html = this._getHtmlForWebview();

        panel.onDidDispose(
            () => {
                this.currentPanel = undefined;
                this.updatePresence(false);
            },
            null,
            this.disposables,
        );

        panel.webview.onDidReceiveMessage((m) => this.handleWebviewMessage(m), null, this.disposables);

        // Sync initial model state
        this.sendModelsListToPanel();
    }

    private updatePresence(isOpen: boolean) {
        this.context.globalState.update(Brainstorm.SESSION_STATE_KEY, isOpen);
    }

    // ── Message Handler ─────────────────────────────────────────────

    /**
     * Routes incoming webview messages to the appropriate handler.
     */
    private async handleWebviewMessage(data: any): Promise<void> {
        if (!this.currentPanel) {
            return;
        }

        switch (data.type) {
            case 'webview-ready':
                await this.sendModelsListToPanel();
                break;

            case 'change-model': {
                // The webview sends { name, providerType, endpoint } for precise switching.
                const modelData = data.value;
                if (modelData && typeof modelData === 'object' && modelData.name) {
                    const entry = await this.modelRegistry.resolvePickerSelection(
                        modelData.name,
                        modelData.providerType,
                    );
                    if (entry) {
                        await this.modelRegistry.switchToModel(entry);
                    }
                } else if (typeof modelData === 'string') {
                    // Backward compat: plain model name string.
                    const entry = await this.modelRegistry.resolvePickerSelection(modelData);
                    if (entry) {
                        await this.modelRegistry.switchToModel(entry);
                    }
                }
                break;
            }

            case 'toggle-structure': {
                await this.context.workspaceState.update(
                    'glyph.brainstorm.structureAware',
                    !!data.value,
                );
                break;
            }

            case 'set-memory-limit': {
                await this.context.workspaceState.update(
                    'glyph.brainstorm.memoryLimit',
                    Number(data.value) || 15,
                );
                break;
            }

            case 'cancel-generation': {
                if (this.activeAbortController) {
                    this.activeAbortController.abort();
                    this.activeAbortController = null;
                }
                break;
            }

            case 'toggle-tools': {
                await this.context.workspaceState.update(
                    'glyph.brainstorm.toolsEnabled',
                    !!data.value,
                );
                break;
            }

            case 'test-tool-calls': {
                try {
                    const supported = await this.llmService.testToolCallSupport();
                    this.currentPanel?.webview.postMessage({
                        type: 'tool-call-test-result',
                        supported,
                    });
                } catch {
                    this.currentPanel?.webview.postMessage({
                        type: 'tool-call-test-result',
                        supported: false,
                    });
                }
                break;
            }

            case 'tool-permission-response': {
                const { id, approved } = data.value;
                const resolver = this.permissionPromises.get(id);
                if (resolver) {
                    resolver(!!approved);
                    this.permissionPromises.delete(id);
                }
                break;
            }

            case 'chat-message': {
                const config = this.glyphConfig.getExtensionConfig();
                const modelName = config.model || 'AI';
                const isCodebaseAware = this.context.workspaceState.get<boolean>(
                    'glyph.brainstorm.codebaseAware',
                    false,
                );
                const isStructureAware = this.context.workspaceState.get<boolean>(
                    'glyph.brainstorm.structureAware',
                    false,
                );
                const memoryLimit = this.context.workspaceState.get<number>(
                    'glyph.brainstorm.memoryLimit',
                    15,
                );
                const isToolsEnabled = this.context.workspaceState.get<boolean>(
                    'glyph.brainstorm.toolsEnabled',
                    false,
                );
                await this.handleChatMessage(
                    data.value,
                    modelName,
                    isCodebaseAware,
                    isStructureAware,
                    memoryLimit,
                    isToolsEnabled,
                );
                break;
            }

            case 'clear-chat':
                this.chatHistory = [];
                break;
        }
    }

    // ── Model List Sync ─────────────────────────────────────────────

    /**
     * Debounces the model list refresh so that the three rapid config
     * updates from `switchToModel` (model → endpoint → providerType)
     * coalesce into a single refresh after all values are up-to-date.
     */
    private debouncedModelRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => this.sendModelsListToPanel(), 150);
    }

    /**
     * Fetches the unified model list and pushes it to the webview.
     */
    private async sendModelsListToPanel(): Promise<void> {
        if (!this.currentPanel) {
            return;
        }

        const config = this.glyphConfig.getExtensionConfig();
        // 1. Fetch the raw list from the registry
        const entries = await this.modelRegistry.getUnifiedModelList();

        const groupedModels: Record<string, any[]> = {};
        const seenKeys = new Set<string>();

        for (const e of entries) {
            /** * 2. STRICT UNIQUE KEY
             * We include the 'source' (Ollama/OpenRouter) to ensure that even if
             * a model has the same name in both places, they are treated as unique.
             */
            const sourceId = (e.source || 'other').toLowerCase();
            const uniqueKey = `${sourceId}::${e.name}`;

            if (seenKeys.has(uniqueKey)) {
                continue;
            }
            seenKeys.add(uniqueKey);

            /** * 3. STRICT GROUPING
             * We use the 'source' property directly for the UI Header.
             * This prevents local models from being grouped under 'OpenRouter'
             * just because they use a similar API 'type'.
             */
            const groupHeader = sourceId.toUpperCase();

            if (!groupedModels[groupHeader]) {
                groupedModels[groupHeader] = [];
            }

            // 4. Map the data for the Webview
            groupedModels[groupHeader].push({
                provider: e.provider,
                providerType: e.providerType,
                endpoint: e.endpoint,
                name: e.name,
                isCurrent: e.isCurrent,
                source: e.source,
            });
        }

        const isCodebaseAware = this.context.workspaceState.get<boolean>(
            'glyph.brainstorm.codebaseAware',
            false,
        );
        const isStructureAware = this.context.workspaceState.get<boolean>(
            'glyph.brainstorm.structureAware',
            false,
        );
        const memoryLimit = this.context.workspaceState.get<number>(
            'glyph.brainstorm.memoryLimit',
            15,
        );

        const isToolsEnabledSaved = this.context.workspaceState.get<boolean>(
            'glyph.brainstorm.toolsEnabled',
            false,
        );

        // 5. Send the clean, separated data to the UI
        this.currentPanel?.webview.postMessage({
            type: 'set-models-list',
            groupedModels,
            currentModel: config.model,
            settings: {
                isCodebaseAware,
                isStructureAware,
                memoryLimit,
                isToolsEnabled: isToolsEnabledSaved,
            },
        });

        this.currentPanel?.webview.postMessage({
            type: 'set-model-name',
            value: config.model || 'AI',
        });

        this.currentPanel?.webview.postMessage({
            type: 'set-codebase-state',
            value: isCodebaseAware,
        });
    }

    // ── Chat Logic ──────────────────────────────────────────────────

    private async handleChatMessage(
        payload: { text: string },
        modelName: string,
        isCodebaseAware: boolean,
        isStructureAware: boolean,
        memoryLimit: number,
        isToolsEnabled: boolean = false,
    ): Promise<void> {
        this.chatHistory.push({ role: 'user', content: payload.text });

        // Truncate history based on user memory limit (messages to keep)
        // Note: each chat "exchange" is 2 messages (user + assistant).
        if (this.chatHistory.length > memoryLimit) {
            this.chatHistory = this.chatHistory.slice(-memoryLimit);
        }

        try {
            this.activeAbortController = new AbortController();
            const signal = this.activeAbortController.signal;

            this.currentPanel?.webview.postMessage({ type: 'set-thinking', value: modelName });

            let augmentedContext = '';

            // Handle Project Structure (Directory Tree)
            if (isStructureAware) {
                const tree = this.repositoryIndexer.parseDirectoryStructure();
                if (tree) {
                    augmentedContext += `\nPROJECT STRUCTURE:\nYou can use the following directory tree to understand the project's architecture and identify relevant files:\n${tree}\n`;
                }
            }

            // Handle Codebase RAG (Specific Snippets)
            if (isCodebaseAware) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                augmentedContext += await this.buildCodebaseContext(payload.text, signal);
            }

            // Calculate "Memory Stats" for the UI Gauge
            // Approx 4 chars per token is a standard heuristic.
            const historyTokens = Math.round(JSON.stringify(this.chatHistory).length / 4);
            const contextTokens = Math.round(augmentedContext.length / 4);

            this.currentPanel?.webview.postMessage({
                type: 'usage-stats',
                value: {
                    historyTokens,
                    contextTokens,
                    messageCount: this.chatHistory.length,
                    memoryLimit,
                },
            });

            let constraintPrompt = '';
            if (isCodebaseAware || isStructureAware) {
                constraintPrompt = `\nCRITICAL INSTRUCTION: The user has enabled "Codebase" and/or "Structure" awareness. You MUST answer their questions strictly based on the provided project context or directory tree. If their question is completely unrelated to the provided codebase context, you MUST politely decline to answer and remind them that you are currently constrained to codebase-specific questions.`;
            }

            const toolsPrompt = isToolsEnabled
                ? `\nTOOL CALLING: ACTIVE — You have access to codebase exploration tools. Use list_project_structure to understand the layout, read_file_content to inspect specific files, search_codebase for keyword search, and list_workspace_files to list available files. Always use these tools when you need more context before answering.
CRITICAL TOOL INSTRUCTION: You MUST invoke these tools using the native tool calling schema execution provided by your API. DO NOT output raw JSON blocks or markdown inside your conversational text to call tools. ONLY execute them natively.`
                : '';

            const systemPrompt = {
                role: 'system' as const,
                content: `You are Glyph, a coding assistant and model integrator created by Saurav Parajulee. Answer questions concisely and provide code block snippets when helpful. You are a versatile tool designed to bridge the gap between different AI providers and the developer's needs.\n\nCODEBASE CONTEXT AWARENESS: ${isCodebaseAware ? 'ACTIVE' : 'INACTIVE'}\nPROJECT STRUCTURE AWARENESS: ${isStructureAware ? 'ACTIVE' : 'INACTIVE'}${constraintPrompt}${toolsPrompt}\n${augmentedContext}`,
            };

            const messages = [systemPrompt, ...this.chatHistory];
            let assistantResponse = '';

            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            await this.llmService.executeChatStream(
                messages,
                (chunk: string) => {
                    assistantResponse += chunk;
                    
                    let processedOutput = assistantResponse;
                    
                    // Replace <think> and </think> with HTML details block
                    processedOutput = processedOutput.replace(/<think>/g, '<details class="think-block" open><summary>Reasoning Process</summary><div class="think-content">');
                    processedOutput = processedOutput.replace(/<\/think>/g, '</div></details>');

                    // Prevent broken rendering if <think> hasn't been closed yet during streaming
                    if (assistantResponse.includes('<think>') && !assistantResponse.includes('</think>')) {
                        processedOutput += '</div></details>';
                    }

                    const renderedHtml = this.md.render(processedOutput);
                    this.currentPanel?.webview.postMessage({
                        type: 'stream-update',
                        html: renderedHtml,
                    });
                },
                this.activeAbortController.signal,
                {
                    toolsEnabled: isToolsEnabled,
                    onActivity: (activity: string) => {
                        this.currentPanel?.webview.postMessage({
                            type: 'tool-activity',
                            value: activity,
                        });
                    },
                    onRequestPermission: (toolName: string, details: string) => {
                        return new Promise<boolean>((resolve) => {
                            const id = Math.random().toString(36).substr(2, 9);
                            this.permissionPromises.set(id, resolve);
                            this.currentPanel?.webview.postMessage({
                                type: 'tool-permission-request',
                                value: { id, toolName, details },
                            });
                        });
                    },
                },
            );

            this.activeAbortController = null;
            this.currentPanel?.webview.postMessage({ type: 'generation-complete' });
            this.chatHistory.push({ role: 'assistant', content: assistantResponse });
        } catch (error) {
            this.activeAbortController = null;
            
            // Do not show an error notification if it was intentionally aborted
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[Brainstorm] Generation was cancelled by the user.');
                this.currentPanel?.webview.postMessage({ type: 'generation-complete' });
                return;
            }

            const errorMessage =
                error instanceof Error ? error.message : 'An unknown error occurred';
            this.currentPanel?.webview.postMessage({
                type: 'error-notification',
                value: errorMessage,
            });
            this.currentPanel?.webview.postMessage({ type: 'generation-complete' });
        }
    }

    /**
     * Builds augmented context from the workspace codebase using vector search.
     */
    private async buildCodebaseContext(userText: string, signal?: AbortSignal): Promise<string> {
        try {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            const directoryTree = this.repositoryIndexer.parseDirectoryStructure();
            if (directoryTree) {
                const files = await this.llmService.identifyRequiredFiles(userText, directoryTree);
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspaceRoot && files.length > 0) {
                    const uris = files.map((f: string) =>
                        vscode.Uri.file(path.resolve(workspaceRoot, f)),
                    );
                    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                    await this.repositoryIndexer.indexFile(uris);
                }
            }

            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const queryVector = await this.llmService.generateEmbeddings(userText, signal);
            if (queryVector) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                const results = await this.llmService.workspaceTable
                    .search(queryVector)
                    .limit(8)
                    .toArray();

                const contextBlocks = results
                    .filter((r: any) => r.text !== 'seed_marker')
                    .map(
                        (r: any) =>
                            `[FROM ${r.path}] Symbol: ${r.symbolName} (${r.text_type})\n${r.text}`,
                    );

                if (contextBlocks.length > 0) {
                    return `\nCRITICAL PROJECT CONTEXT RETRIEVED:\nYou must use the following real symbols and implementations from the user's workspace to accurately answer their question:\n\n${contextBlocks.join('\n\n')}\n`;
                }
            }
        } catch (_err) {
            // Non-fatal — proceed without context.
        }

        return '';
    }

    // ── Cleanup ─────────────────────────────────────────────────────

    /**
     * Disposes all panel resources.
     */
    private dispose(): void {
        this.currentPanel = undefined;
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
    /**
     * Reads the brainstorm chat HTML template from disk and injects
     * webview-safe URIs for the separated CSS and JS files.
     */
    private _getHtmlForWebview(): string {
        const webviewDir = path.join(
            this.context.extensionUri.fsPath,
            'dist',
            'webview',
            'brainstorm',
        );

        const htmlPath = path.join(webviewDir, 'index.html');
        const webview = this.currentPanel?.webview;

        if (!webview || !fs.existsSync(htmlPath)) {
            return `<html><body><h3>Error: Webview assets not found at ${htmlPath}</h3></body></html>`;
        }

        let html = fs.readFileSync(htmlPath, 'utf8');

        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewDir, 'style.css')));
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewDir, 'script.js')));

        html = html.replace('{{styleUri}}', styleUri.toString());
        html = html.replace('{{scriptUri}}', scriptUri.toString());

        return html;
    }

    // ── Markdown Initialization ─────────────────────────────────────

    /**
     * Configures MarkdownIt with highlight.js and custom fence rendering.
     */
    private initializeMarkdown(): MarkdownIt {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            highlight: (str, lang) => {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(str, { language: lang }).value;
                    } catch (__) {}
                }
                return '';
            },
        });

        md.renderer.rules.fence = (tokens, idx, options, _env, _self) => {
            const token = tokens[idx];
            const lang = token.info ? token.info.trim() : 'code';
            const rawCode = md.utils.escapeHtml(token.content);
            const highlightedHTML = options.highlight
                ? options.highlight(token.content, lang as string, '')
                : rawCode;

            const copySvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            const checkSvg = `<svg class="check-icon" style="display:none;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

            return `
<div class="code-block-wrapper">
    <div class="code-header">
        <span class="code-lang">${lang}</span>
        <button class="copy-btn" data-clipboard="${rawCode.replace(/"/g, '&quot;')}">
            <span class="copy-icon-wrapper">${copySvg}</span>
            ${checkSvg}
        </button>
    </div>
    <pre class="hljs"><code>${highlightedHTML || rawCode}</code></pre>
</div>`;
        };

        return md;
    }
}
