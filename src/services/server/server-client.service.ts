import * as vscode from 'vscode';
import type GlyphConfig from '../../config/glyph.config';

/**
 * Client configuration sent to the server with every request.
 * Mirrors the server's `ClientConfig` interface.
 */
interface ClientConfig {
    model: string;
    providerType: string;
    endpoint: string;
    apiKey: string;
    embeddingModel?: string;
    reasoningBudgetTokens?: number;
}

/** Search result from the vector index. */
export interface SearchResult {
    text: string;
    symbolName: string;
    text_type: string;
    path: string;
}

/** Health check response. */
interface HealthResponse {
    status: 'ok' | 'error';
    uptime: number;
    version: string;
}

/** SSE event from the chat stream REST fallback. */
interface SSEEvent {
    type: 'chunk' | 'activity' | 'permission-request' | 'done' | 'error';
    content?: string;
    id?: string;
    toolName?: string;
    details?: string;
    message?: string;
}

/** Callbacks for Socket.IO chat streaming. */
export interface ChatStreamCallbacks {
    onChunk: (content: string) => void;
    onActivity?: (activity: string) => void;
    onPermissionRequest?: (id: string, toolName: string, details: string) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
}

/**
 * Thin HTTP + Socket.IO client for communicating with glyph-server.
 *
 * Replaces the extension's former LLMService, VectorDatabaseService,
 * RepositoryIndexerService, and LLMHealth — all of which now run
 * on the server side.
 *
 * Transport:
 *   - REST for stateless request/response (inline code/docs, models, health, indexing)
 *   - Socket.IO for bidirectional streaming (chat, tool permissions, live code events)
 */
export default class ServerClient {
    private socket: any = null; // socket.io-client Socket
    private _isConnected = false;
    private reconnectTimer: ReturnType<typeof setInterval> | undefined;

    private readonly _onConnectionChange = new vscode.EventEmitter<boolean>();
    public readonly onConnectionChange: vscode.Event<boolean> = this._onConnectionChange.event;

    constructor(
        private readonly glyphConfig: GlyphConfig,
        private readonly context: vscode.ExtensionContext,
    ) {
        context.subscriptions.push(this._onConnectionChange);
    }

    // ── Connection Management ────────────────────────────────────

    /** Returns the configured server URL. */
    private get serverUrl(): string {
        const config = vscode.workspace.getConfiguration('glyph');
        return config.get<string>('serverUrl', 'http://localhost:9741');
    }

    /** Returns the configured auth token, if any. */
    private get authToken(): string {
        const config = vscode.workspace.getConfiguration('glyph');
        return config.get<string>('serverAuthToken', '');
    }

    /** Whether the client is connected to the server. */
    public get isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * Connects to the glyph-server via Socket.IO.
     */
    public async connect(): Promise<void> {
        try {
            // Dynamic import of socket.io-client
            const { io } = await import('socket.io-client');

            const opts: any = {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: 2000,
                reconnectionAttempts: Infinity,
            };

            if (this.authToken) {
                opts.auth = { token: this.authToken };
            }

            this.socket = io(this.serverUrl, opts);

            this.socket.on('connect', () => {
                console.log('[ServerClient] Connected to glyph-server');
                this._isConnected = true;
                this._onConnectionChange.fire(true);
            });

            this.socket.on('disconnect', () => {
                console.log('[ServerClient] Disconnected from glyph-server');
                this._isConnected = false;
                this._onConnectionChange.fire(false);
            });

            this.socket.on('connect_error', (err: Error) => {
                console.warn('[ServerClient] Connection error:', err.message);
                this._isConnected = false;
                this._onConnectionChange.fire(false);
            });
        } catch (error) {
            console.error('[ServerClient] Failed to initialize socket:', error);
            this._isConnected = false;
            this._onConnectionChange.fire(false);
        }
    }

    /**
     * Disconnects from the server.
     */
    public disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this._isConnected = false;
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
        }
    }

    // ── Client Config Builder ────────────────────────────────────

    /**
     * Builds the ClientConfig payload from VS Code settings + SecretStorage.
     */
    private async buildClientConfig(): Promise<ClientConfig> {
        const config = this.glyphConfig.getExtensionConfig();
        const apiKey = (await this.glyphConfig.getApiKey(config.providerType)) || '';
        const vsConfig = vscode.workspace.getConfiguration('glyph');
        const reasoningBudgetTokens = vsConfig.get<number>('reasoning.budgetTokens', 10000);

        return {
            model: config.model,
            providerType: config.providerType,
            endpoint: config.endpoint,
            apiKey,
            embeddingModel: config.embeddingModel,
            reasoningBudgetTokens,
        };
    }

    // ── HTTP Helpers ─────────────────────────────────────────────

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        return headers;
    }

    private async post<T = any>(path: string, body: any): Promise<T> {
        const url = `${this.serverUrl}${path}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error((errorBody as any).error || `Server error: ${response.status}`);
        }

        return response.json() as Promise<T>;
    }

    private async get<T = any>(path: string, params?: Record<string, string>): Promise<T> {
        const url = new URL(`${this.serverUrl}${path}`);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                url.searchParams.set(key, value);
            }
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: this.buildHeaders(),
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error((errorBody as any).error || `Server error: ${response.status}`);
        }

        return response.json() as Promise<T>;
    }

    // ── Health ───────────────────────────────────────────────────

    /**
     * Checks if the server is reachable and healthy.
     */
    public async healthCheck(): Promise<HealthResponse> {
        return this.get<HealthResponse>('/api/health');
    }

    /**
     * Quick boolean check — is the server alive?
     */
    public async isServerReachable(): Promise<boolean> {
        try {
            const health = await this.healthCheck();
            return health.status === 'ok';
        } catch {
            return false;
        }
    }

    // ── Models ───────────────────────────────────────────────────

    /**
     * Lists available models from a provider via the server.
     */
    public async getModels(
        providerType: string,
        endpoint: string,
        apiKey: string,
    ): Promise<string[]> {
        const result = await this.get<{ models: string[] }>('/api/models', {
            providerType,
            endpoint,
            apiKey,
        });
        return result.models || [];
    }

    /**
     * Checks if a provider is reachable via the server.
     */
    public async isProviderReachable(
        providerType: string,
        endpoint: string,
        apiKey: string,
        model?: string,
    ): Promise<boolean> {
        try {
            const params: Record<string, string> = { providerType, endpoint, apiKey };
            if (model) params.model = model;

            const result = await this.get<{ reachable: boolean }>('/api/models/reachable', params);
            return result.reachable;
        } catch {
            return false;
        }
    }

    // ── Inline Code Generation (REST) ────────────────────────────

    /**
     * Generates or modifies code via the server.
     */
    public async generateCode(
        prompt: string,
        codeContext: string,
        languageId: string,
        options?: { workspaceRoot?: string; useTools?: boolean },
    ): Promise<string> {
        const config = await this.buildClientConfig();
        const result = await this.post<{ result: string }>('/api/inline/code', {
            prompt,
            codeContext,
            languageId,
            config,
            options,
        });
        return result.result;
    }

    /**
     * Generates documentation comments via the server.
     */
    public async generateDocs(codeContext: string, languageId: string): Promise<string> {
        const config = await this.buildClientConfig();
        const result = await this.post<{ result: string }>('/api/inline/docs', {
            codeContext,
            languageId,
            config,
        });
        return result.result;
    }

    // ── Chat Streaming (Socket.IO) ───────────────────────────────

    /**
     * Starts a chat stream via Socket.IO.
     * Returns a Promise that resolves when the stream is complete.
     */
    public async streamChat(
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
        callbacks: ChatStreamCallbacks,
        abortSignal?: AbortSignal,
        options?: {
            useTools?: boolean;
            workspaceRoot?: string;
            directoryTree?: string;
            requireToolPermission?: boolean;
        },
    ): Promise<string> {
        if (!this.socket || !this._isConnected) {
            throw new Error('Not connected to glyph-server. Please ensure the server is running.');
        }

        const config = await this.buildClientConfig();

        return new Promise<string>((resolve, reject) => {
            let fullText = '';

            const cleanup = () => {
                this.socket.off('chat:chunk', onChunk);
                this.socket.off('chat:activity', onActivity);
                this.socket.off('chat:permission-request', onPermission);
                this.socket.off('chat:done', onDone);
                this.socket.off('chat:error', onError);
            };

            const onChunk = (data: { content: string }) => {
                fullText += data.content;
                callbacks.onChunk(data.content);
            };

            const onActivity = (data: { content: string }) => {
                callbacks.onActivity?.(data.content);
            };

            const onPermission = (data: { id: string; toolName: string; details: string }) => {
                callbacks.onPermissionRequest?.(data.id, data.toolName, data.details);
            };

            const onDone = () => {
                cleanup();
                callbacks.onDone?.();
                resolve(fullText);
            };

            const onError = (data: { message: string }) => {
                cleanup();
                callbacks.onError?.(data.message);
                reject(new Error(data.message));
            };

            // Register listeners
            this.socket.on('chat:chunk', onChunk);
            this.socket.on('chat:activity', onActivity);
            this.socket.on('chat:permission-request', onPermission);
            this.socket.on('chat:done', onDone);
            this.socket.on('chat:error', onError);

            // Handle abort
            if (abortSignal) {
                const onAbort = () => {
                    this.socket.emit('chat:cancel');
                    cleanup();
                    reject(new DOMException('Aborted', 'AbortError'));
                };

                if (abortSignal.aborted) {
                    onAbort();
                    return;
                }
                abortSignal.addEventListener('abort', onAbort, { once: true });
            }

            // Start the stream
            this.socket.emit('chat:start', {
                messages,
                config,
                options,
            });
        });
    }

    /**
     * Cancels the active chat stream.
     */
    public cancelChat(): void {
        if (this.socket && this._isConnected) {
            this.socket.emit('chat:cancel');
        }
    }

    /**
     * Responds to a tool permission request from the server.
     */
    public respondToPermission(requestId: string, approved: boolean): void {
        if (this.socket && this._isConnected) {
            this.socket.emit('chat:permission-response', { id: requestId, approved });
        }
    }

    // ── Vector Indexing (REST) ────────────────────────────────────

    /**
     * Sends file symbols to the server for embedding and indexing.
     */
    public async indexFile(
        workspacePath: string,
        filePath: string,
        symbols: Array<{ name: string; kind: string; text: string }>,
    ): Promise<{ indexed: number; skipped: number; deleted: number }> {
        const config = await this.buildClientConfig();
        return this.post('/api/index/file', {
            filePath,
            content: '', // Content is embedded in symbols
            symbols,
            config,
            workspacePath,
        });
    }

    /**
     * Searches the vector index for relevant code context.
     */
    public async searchIndex(
        workspacePath: string,
        query: string,
        limit?: number,
    ): Promise<SearchResult[]> {
        const config = await this.buildClientConfig();
        const result = await this.post<{ results: SearchResult[] }>('/api/index/search', {
            query,
            config,
            workspacePath,
            limit,
        });
        return result.results || [];
    }

    /**
     * Deletes indexed data for a file.
     */
    public async deleteIndexedFile(workspacePath: string, filePath: string): Promise<void> {
        await this.post('/api/index/file', { filePath, workspacePath });
    }
}
