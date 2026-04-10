import * as fs from 'node:fs';
import * as path from 'node:path';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import type GlyphConfig from '../../config/glyph.config';
import type { LLMService, ModelRegistryService } from '../../services';
import BaseCommand from '../core/base.command';

/**
 * Brainstorm — interactive AI chat panel.
 *
 * Lifecycle:
 *  - Implements `WebviewPanelSerializer` so that VS Code can restore
 *    the panel on restart if it was left open.
 *  - Tracks explicit close via `onDidDispose` to prevent orphaned restore.
 *  - Subscribes to `GlyphConfig.onDidChange` to sync model state in real time.
 */
export default class Brainstorm extends BaseCommand implements vscode.WebviewPanelSerializer {
    public id: string = 'glyph.brainstorm';

    private currentPanel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];
    private chatHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    private md: MarkdownIt;
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    /** Track whether the user explicitly closed the panel. */
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

        // Register the serializer so VS Code can restore the panel on reload.
        vscode.window.registerWebviewPanelSerializer('glyph.brainstormPanel', this);

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

    // ── WebviewPanelSerializer ───────────────────────────────────────

    /**
     * Called by VS Code when restoring a previously open Brainstorm panel.
     * Only restores if the session was NOT explicitly closed by the user.
     */
    public async deserializeWebviewPanel(
        panel: vscode.WebviewPanel,
        _state: unknown,
    ): Promise<void> {
        const wasOpen = this.context.globalState.get<boolean>(Brainstorm.SESSION_STATE_KEY, false);

        if (!wasOpen) {
            // User explicitly closed — do not restore.
            panel.dispose();
            return;
        }

        this.currentPanel = panel;
        this.attachPanel(panel);
    }

    // ── Command Action ──────────────────────────────────────────────

    public action = () => {
        if (this.currentPanel) {
            this.currentPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const extensionUri = this.context.extensionUri;

        const panel = vscode.window.createWebviewPanel(
            'glyph.brainstormPanel',
            'Glyph Brainstorm',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            },
        );

        this.currentPanel = panel;
        this.attachPanel(panel);

        // Mark session as open.
        this.context.globalState.update(Brainstorm.SESSION_STATE_KEY, true);
    };

    // ── Panel Setup ─────────────────────────────────────────────────

    /**
     * Wires up message handlers, disposal, and initial state for a webview panel.
     */
    private attachPanel(panel: vscode.WebviewPanel): void {
        panel.webview.html = this._getHtmlForWebview();

        panel.onDidDispose(
            () => {
                // Mark session as explicitly closed.
                this.context.globalState.update(Brainstorm.SESSION_STATE_KEY, false);
                this.dispose();
            },
            null,
            this.disposables,
        );

        panel.webview.onDidReceiveMessage(
            (data) => this.handleWebviewMessage(data),
            null,
            this.disposables,
        );
    }

    // ── Message Handler ─────────────────────────────────────────────

    /**
     * Routes incoming webview messages to the appropriate handler.
     */
    private async handleWebviewMessage(data: any): Promise<void> {
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

            case 'toggle-codebase': {
                // Store the toggle state in workspace scope.
                await this.context.workspaceState.update(
                    'glyph.brainstorm.codebaseAware',
                    !!data.value,
                );
                break;
            }

            case 'chat-message': {
                const config = this.glyphConfig.getExtensionConfig();
                const modelName = config.model || 'AI';
                const isCodebaseAware = this.context.workspaceState.get<boolean>(
                    'glyph.brainstorm.codebaseAware',
                    false,
                );
                await this.handleChatMessage(data.value, modelName, isCodebaseAware);
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

        // 5. Send the clean, separated data to the UI
        this.currentPanel.webview.postMessage({
            type: 'set-models-list',
            groupedModels,
            currentModel: config.model,
        });

        this.currentPanel.webview.postMessage({
            type: 'set-model-name',
            value: config.model || 'AI',
        });

        this.currentPanel.webview.postMessage({
            type: 'set-codebase-state',
            value: isCodebaseAware,
        });
    }

    // ── Chat Logic ──────────────────────────────────────────────────

    /**
     * Handles a chat message from the webview, including optional codebase context injection.
     */
    private async handleChatMessage(
        payload: { text: string },
        modelName: string,
        isCodebaseAware: boolean,
    ): Promise<void> {
        this.chatHistory.push({ role: 'user', content: payload.text });

        try {
            this.currentPanel?.webview.postMessage({ type: 'set-thinking', value: modelName });

            let augmentedContext = '';

            if (isCodebaseAware) {
                augmentedContext = await this.buildCodebaseContext(payload.text);
            }

            const systemPrompt = {
                role: 'system' as const,
                content: `You are Glyph, a coding assistant and model integrator created by Saurav Parajulee. Answer questions concisely and provide code block snippets when helpful. You are a versatile tool designed to bridge the gap between different AI providers and the developer's needs.\n${augmentedContext}`,
            };

            const messages = [systemPrompt, ...this.chatHistory];
            let assistantResponse = '';

            await this.llmService.executeChatStream(messages, (chunk: string) => {
                assistantResponse += chunk;
                const renderedHtml = this.md.render(assistantResponse);
                this.currentPanel?.webview.postMessage({
                    type: 'stream-update',
                    html: renderedHtml,
                });
            });

            this.currentPanel?.webview.postMessage({ type: 'generation-complete' });
            this.chatHistory.push({ role: 'assistant', content: assistantResponse });
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'An unknown error occurred';
            this.currentPanel?.webview.postMessage({
                type: 'error-notification',
                value: errorMessage,
            });
        }
    }

    /**
     * Builds augmented context from the workspace codebase using vector search.
     */
    private async buildCodebaseContext(userText: string): Promise<string> {
        try {
            const directoryTree = this.repositoryIndexer.parseDirectoryStructure();
            if (directoryTree) {
                const files = await this.llmService.identifyRequiredFiles(userText, directoryTree);
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspaceRoot && files.length > 0) {
                    const uris = files.map((f: string) =>
                        vscode.Uri.file(path.resolve(workspaceRoot, f)),
                    );
                    await this.repositoryIndexer.indexFile(uris);
                }
            }

            const queryVector = await this.llmService.generateEmbeddings(userText);
            if (queryVector) {
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

    // ── HTML ────────────────────────────────────────────────────────

    /**
     * Reads the brainstorm chat HTML template from disk and injects
     * webview-safe URIs for the separated CSS and JS files.
     */
    private _getHtmlForWebview(): string {
        const webviewDir = path.join(
            this.context.extensionUri.fsPath,
            'src',
            'webview',
            'brainstorm',
        );

        const htmlPath = path.join(webviewDir, 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        const webview = this.currentPanel?.webview;

        if (!webview) {
            const errorHtmlPath = path.join(webviewDir, 'error.html');
            return fs.readFileSync(errorHtmlPath, 'utf8');
        }

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
                    } catch (__) { }
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
