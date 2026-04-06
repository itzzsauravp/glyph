import * as fs from 'node:fs';
import * as path from 'node:path';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import type LLMService from '../services/llm.service';
import BaseCommand from './base.command';

export default class Brainstrom extends BaseCommand {
    public id: string = 'glyph.brainstrom';

    private currentPanel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];
    private chatHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    private md: MarkdownIt;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly llmService: LLMService,
        private readonly repositoryIndexer: {
            indexFile(uris: vscode.Uri | vscode.Uri[]): Promise<void>;
            parseDirectoryStructure(): string | undefined;
        },
    ) {
        super();

        // Initialize Markdown-It with highlight.js
        this.md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            highlight: (str, lang) => {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(str, { language: lang }).value;
                    } catch (__) {}
                }
                return ''; // use external default escaping
            },
        });

        // Override the fence renderer to wrap code blocks with a copy button
        const _defaultRender =
            this.md.renderer.rules.fence ||
            ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

        this.md.renderer.rules.fence = (tokens, idx, options, _env, _self) => {
            const token = tokens[idx];
            const lang = token.info ? token.info.trim() : 'code';
            const rawCode = this.md.utils.escapeHtml(token.content);
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
    }

    public action = () => {
        if (this.currentPanel) {
            this.currentPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const extensionUri = this.context.extensionUri;

        this.currentPanel = vscode.window.createWebviewPanel(
            'glyph.brainstormPanel',
            'Glyph Brainstorm',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            },
        );

        this.currentPanel.webview.html = this._getHtmlForWebview();
        this.currentPanel.onDidDispose(() => this.dispose(), null, this.disposables);

        const config = this.llmService.glyphConfig.getExtensionConfig();
        const modelName = config.model || 'AI';

        this.currentPanel.webview.onDidReceiveMessage(
            async (data) => {
                switch (data.type) {
                    case 'webview-ready': {
                        const registered = this.llmService.glyphConfig.getRegisteredModels();
                        const modelsList = [
                            {
                                provider: 'Local (Fallback)',
                                name: config.model || 'Default',
                                id: 'local',
                            },
                            ...registered.map((m) => ({
                                provider: m.provider,
                                name: m.model,
                                id: JSON.stringify(m),
                            })),
                        ];

                        this.currentPanel?.webview.postMessage({
                            type: 'set-models-list',
                            models: modelsList.map((m) => ({
                                ...m,
                                isCurrent: m.name === config.model,
                            })),
                            currentModel: config.model,
                        });
                        this.currentPanel?.webview.postMessage({
                            type: 'set-model-name',
                            value: config.model || 'AI',
                        });
                        break;
                    }
                    case 'change-model': {
                        try {
                            if (data.value && data.value !== 'local') {
                                const parsed = JSON.parse(data.value);
                                await this.llmService.glyphConfig.updateModel(parsed.name);
                                await this.llmService.glyphConfig.updateEndpoint(parsed.endpoint);
                                await this.llmService.glyphConfig.updateProviderType(
                                    parsed.provider,
                                );
                                this.currentPanel?.webview.postMessage({
                                    type: 'set-model-name',
                                    value: parsed.name,
                                });
                            }
                        } catch (e) {
                            console.error('Failed to swap model context', e);
                        }
                        break;
                    }
                    case 'add-context-buffer': {
                        const activeEditor = vscode.window.activeTextEditor;
                        if (activeEditor) {
                            vscode.window.showInformationMessage(
                                `Indexing ${path.basename(activeEditor.document.uri.fsPath)}...`,
                            );
                            await this.repositoryIndexer.indexFile(activeEditor.document.uri);
                            this.currentPanel?.webview.postMessage({
                                type: 'context-added',
                                value: path.basename(activeEditor.document.uri.fsPath),
                            });
                        } else {
                            this.currentPanel?.webview.postMessage({
                                type: 'error-notification',
                                value: 'No active editor buffer open.',
                            });
                        }
                        break;
                    }
                    case 'add-context-codebase': {
                        this.currentPanel?.webview.postMessage({
                            type: 'context-added',
                            value: 'Workspace Codebase',
                        });
                        break;
                    }
                    case 'chat-message': {
                        await this.handleChatMessage(data.value, modelName);
                        break;
                    }
                    case 'clear-chat': {
                        this.chatHistory = [];
                        break;
                    }
                }
            },
            null,
            this.disposables,
        );
    };

    private dispose() {
        this.currentPanel = undefined;
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async handleChatMessage(
        payload: { text: string; contexts: string[] },
        modelName: string,
    ) {
        this.chatHistory.push({ role: 'user', content: payload.text });

        try {
            this.currentPanel?.webview.postMessage({ type: 'set-thinking', value: modelName });

            let augmentedContext = '';

            // Handle Context Injections before executing stream
            if (payload.contexts && payload.contexts.length > 0) {
                let contextBlocks = [];

                // If Codebase context is active, dynamically index relevant files first!
                if (payload.contexts.includes('Workspace Codebase')) {
                    const directoryTree = this.repositoryIndexer.parseDirectoryStructure();
                    if (directoryTree) {
                        const files = await this.llmService.identifyRequiredFiles(
                            payload.text,
                            directoryTree,
                        );
                        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                        if (workspaceRoot && files.length > 0) {
                            const uris = files.map((f: string) =>
                                vscode.Uri.file(path.resolve(workspaceRoot, f)),
                            );
                            await this.repositoryIndexer.indexFile(uris);
                        }
                    }
                }

                // Query LanceDB for all context chunks
                const queryVector = await this.llmService.generateEmbeddings(payload.text);
                if (queryVector) {
                    const results = await this.llmService.workspaceTable
                        .search(queryVector)
                        .limit(8)
                        .toArray();
                    contextBlocks = results
                        .filter((r) => r.text !== 'seed_marker')
                        .map(
                            (r) =>
                                `[FROM ${r.path}] Symbol: ${r.symbolName} (${r.text_type})\n${r.text}`,
                        );

                    if (contextBlocks.length > 0) {
                        augmentedContext = `
CRITICAL PROJECT CONTEXT RETRIEVED:
You must use the following real symbols and implementations from the user's workspace to accurately answer their question:

${contextBlocks.join('\n\n')}
`;
                    }
                }
            }

            const systemPrompt = {
                role: 'system' as const,
                content: `You are Glyph, an expert AI programming assistant. Answer questions concisely and provide code block snippets when helpful.\n${augmentedContext}`,
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

    private _getHtmlForWebview(): string {
        const htmlPath = path.join(
            this.context.extensionUri.fsPath,
            'src',
            'resources',
            'brainstorm-chat.html',
        );
        return fs.readFileSync(htmlPath, 'utf8');
    }
}
