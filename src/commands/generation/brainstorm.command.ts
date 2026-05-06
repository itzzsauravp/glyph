import * as fs from 'node:fs';
import * as path from 'node:path';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import type GlyphConfig from '../../config/glyph.config';
import type { ServerClient, ModelRegistryService } from '../../services';
import BaseCommand from '../core/base.command';

/**
 * Brainstorm — interactive AI chat panel in a Webview Tab.
 *
 * v0.5.0: Uses ServerClient (Socket.IO) for streaming instead of direct LLM calls.
 */
export default class Brainstorm extends BaseCommand implements vscode.WebviewPanelSerializer {
    public readonly id = 'glyph.brainstorm';
    public static readonly viewType = 'glyphBrainstorm';

    private currentPanel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];
    private chatHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    private md: MarkdownIt;
    private activeAbortController: AbortController | null = null;
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    private static readonly SESSION_STATE_KEY = 'glyph.brainstorm.sessionOpen';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly glyphConfig: GlyphConfig,
        private readonly serverClient: ServerClient,
        private readonly modelRegistry: ModelRegistryService,
    ) {
        super();
        this.md = this.initializeMarkdown();

        // Subscribe to config changes — push model updates to open panels.
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

            if (e.key === 'model' || e.key === 'providerType' || e.key === 'endpoint') {
                this.debouncedModelRefresh();
            }
        });

        // Subscribe to server connection changes
        this.serverClient.onConnectionChange((connected) => {
            this.currentPanel?.webview.postMessage({
                type: 'server-connection',
                value: connected,
            });
        });
    }

    /**
     * Launch/Focus the Brainstorm chat panel.
     */
    public action = (): void => {
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
                    vscode.Uri.file(
                        path.join(this.context.extensionPath, 'dist', 'webview', 'brainstorm'),
                    ),
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

        panel.iconPath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'images', 'brain.svg'),
        );

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

        panel.webview.onDidReceiveMessage(
            (m) => this.handleWebviewMessage(m),
            null,
            this.disposables,
        );

        // Sync initial state
        this.sendModelsListToPanel();
        this.currentPanel.webview.postMessage({
            type: 'server-connection',
            value: this.serverClient.isConnected,
        });
    }

    private updatePresence(isOpen: boolean) {
        this.context.globalState.update(Brainstorm.SESSION_STATE_KEY, isOpen);
    }

    // ── Message Handler ─────────────────────────────────────────────

    private async handleWebviewMessage(data: any): Promise<void> {
        if (!this.currentPanel) {
            return;
        }

        switch (data.type) {
            case 'webview-ready':
                await this.sendModelsListToPanel();
                break;

            case 'change-model': {
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
                this.serverClient.cancelChat();
                break;
            }

            case 'toggle-tools': {
                await this.context.workspaceState.update(
                    'glyph.brainstorm.toolsEnabled',
                    !!data.value,
                );
                break;
            }

            case 'tool-permission-response': {
                const { id, approved } = data.value;
                this.serverClient.respondToPermission(id, !!approved);
                break;
            }

            case 'chat-message': {
                const config = this.glyphConfig.getExtensionConfig();
                const modelName = config.model || 'AI';
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
                    isStructureAware,
                    memoryLimit,
                    isToolsEnabled,
                );
                break;
            }

            case 'clear-chat':
                this.chatHistory = [];
                break;

            case 'start-server':
                vscode.commands.executeCommand('glyph.startServer');
                break;
        }
    }

    // ── Model List Sync ─────────────────────────────────────────────

    private debouncedModelRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => this.sendModelsListToPanel(), 150);
    }

    private async sendModelsListToPanel(): Promise<void> {
        if (!this.currentPanel) {
            return;
        }

        const config = this.glyphConfig.getExtensionConfig();
        const entries = await this.modelRegistry.getUnifiedModelList();

        const groupedModels: Record<string, any[]> = {};
        const seenKeys = new Set<string>();

        for (const e of entries) {
            const sourceId = (e.source || 'other').toLowerCase();
            const uniqueKey = `${sourceId}::${e.name}`;

            if (seenKeys.has(uniqueKey)) {
                continue;
            }
            seenKeys.add(uniqueKey);

            const groupHeader = sourceId.toUpperCase();

            if (!groupedModels[groupHeader]) {
                groupedModels[groupHeader] = [];
            }

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
        isStructureAware: boolean,
        memoryLimit: number,
        isToolsEnabled: boolean = false,
    ): Promise<void> {
        this.chatHistory.push({ role: 'user', content: payload.text });

        if (this.chatHistory.length > memoryLimit) {
            this.chatHistory = this.chatHistory.slice(-memoryLimit);
        }

        try {
            this.activeAbortController = new AbortController();
            const signal = this.activeAbortController.signal;

            this.currentPanel?.webview.postMessage({ type: 'set-thinking', value: modelName });

            // Build system prompt (structure/codebase context is now handled server-side via tools)
            const requirePermission = vscode.workspace
                .getConfiguration('glyph')
                .get<boolean>('agent.requireToolPermission', true);

            const permissionGatingText = requirePermission
                ? 'are gated by the system. The user will be automatically prompted for approval when you invoke them.'
                : 'are fully unrestricted and will execute immediately.';

            const toolsPrompt = isToolsEnabled
                ? `\nTOOL CALLING: ACTIVE — You have access to codebase tools. Read tools (list_project_structure, read_file_content, read_lines, search_codebase, grep_search, list_workspace_files) execute freely. Write tools (create_file, edit_file, run_command) ${permissionGatingText}
CRITICAL TOOL INSTRUCTION: You MUST invoke tools using the native tool calling API. DO NOT ask the user for permission verbally before using a tool. JUST INVOKE THE TOOL directly. The system handles all permission dialogues.`
                : '';

            const systemPrompt = {
                role: 'system' as const,
                content: `You are Glyph, a coding assistant and model integrator created by Saurav Parajulee. Answer questions concisely and provide code block snippets when helpful. You are a versatile tool designed to bridge the gap between different AI providers and the developer's needs.\n\nPROJECT STRUCTURE AWARENESS: ${isStructureAware ? 'ACTIVE' : 'INACTIVE'}${toolsPrompt}`,
            };

            const messages = [systemPrompt, ...this.chatHistory];
            let assistantResponse = '';

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            // Usage stats estimate
            const historyTokens = Math.round(JSON.stringify(this.chatHistory).length / 4);
            this.currentPanel?.webview.postMessage({
                type: 'usage-stats',
                value: {
                    historyTokens,
                    contextTokens: 0,
                    messageCount: this.chatHistory.length,
                    memoryLimit,
                },
            });

            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            // Stream via Socket.IO
            await this.serverClient.streamChat(
                messages,
                {
                    onChunk: (chunk: string) => {
                        assistantResponse += chunk;

                        let processedOutput = assistantResponse;

                        processedOutput = processedOutput.replace(
                            /<think>/g,
                            '\n<details class="think-block" open><summary><strong>Thinking Process</strong></summary>\n<div class="think-content">\n\n',
                        );
                        processedOutput = processedOutput.replace(
                            /<\/think>/g,
                            '\n\n</div>\n</details>\n',
                        );

                        if (
                            assistantResponse.includes('<think>') &&
                            !assistantResponse.includes('</think>')
                        ) {
                            processedOutput += '\n\n</div>\n</details>\n';
                        }

                        const renderedHtml = this.md.render(processedOutput);
                        this.currentPanel?.webview.postMessage({
                            type: 'stream-update',
                            html: renderedHtml,
                        });
                    },
                    onActivity: (activity: string) => {
                        this.currentPanel?.webview.postMessage({
                            type: 'tool-activity',
                            value: activity,
                        });
                    },
                    onPermissionRequest: (id: string, toolName: string, details: string) => {
                        this.currentPanel?.webview.postMessage({
                            type: 'tool-permission-request',
                            value: { id, toolName, details },
                        });
                    },
                    onDone: () => {
                        // handled by Promise resolution
                    },
                    onError: (message: string) => {
                        this.currentPanel?.webview.postMessage({
                            type: 'error-notification',
                            value: message,
                        });
                    },
                },
                signal,
                {
                    useTools: isToolsEnabled,
                    workspaceRoot,
                    requireToolPermission: requirePermission,
                },
            );

            this.activeAbortController = null;
            this.currentPanel?.webview.postMessage({ type: 'generation-complete' });
            this.chatHistory.push({ role: 'assistant', content: assistantResponse });
        } catch (error) {
            this.activeAbortController = null;

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

    // ── Cleanup ─────────────────────────────────────────────────────

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
