import * as vscode from 'vscode';
import type ServerClient from '../server/server-client.service';

/**
 * Background indexing service that runs on extension activation.
 *
 * Responsibilities:
 *   1. On activation: scan all workspace files, extract symbols, send to server for indexing
 *   2. On file save/create/delete: re-index the changed file
 *   3. Hash-based change detection is handled server-side (only changed symbols are re-embedded)
 *
 * Uses VS Code's DocumentSymbolProvider to extract symbols — this is the
 * reason indexing MUST happen on the client side (the server has no access
 * to VS Code's language services).
 */
export default class BackgroundIndexerService {
    private readonly disposables: vscode.Disposable[] = [];
    private indexingInProgress = false;
    private queuedFiles = new Set<string>();

    /** File extensions to index. */
    private static readonly SUPPORTED_EXTENSIONS = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
        '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
        '.kt', '.scala', '.vue', '.svelte',
    ]);

    /** Directories to skip. */
    private static readonly IGNORE_PATTERNS = [
        '**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**',
        '**/.git/**', '**/.glyph/**', '**/vendor/**', '**/__pycache__/**',
        '**/target/**', '**/bin/**', '**/obj/**',
    ];

    constructor(
        private readonly serverClient: ServerClient,
        private readonly context: vscode.ExtensionContext,
    ) {}

    /**
     * Starts background indexing: full scan + file watchers.
     */
    public async start(): Promise<void> {
        // Only index if server is reachable
        if (!this.serverClient.isConnected) {
            console.log('[BackgroundIndexer] Server not connected, skipping initial index');

            // Wait for connection then index
            const disposable = this.serverClient.onConnectionChange(async (connected) => {
                if (connected) {
                    disposable.dispose();
                    await this.performFullIndex();
                }
            });
            this.disposables.push(disposable);
        } else {
            await this.performFullIndex();
        }

        // Watch for file changes
        this.setupFileWatchers();
    }

    /**
     * Performs a full workspace index — called on first activation.
     */
    private async performFullIndex(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const workspacePath = workspaceFolders[0].uri.fsPath;

        console.log('[BackgroundIndexer] Starting full workspace index...');
        this.indexingInProgress = true;

        try {
            // Find all source files
            const files = await vscode.workspace.findFiles(
                '**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h,hpp,cs,rb,php,swift,kt,scala,vue,svelte}',
                `{${BackgroundIndexerService.IGNORE_PATTERNS.join(',')}}`,
                5000, // limit to 5000 files
            );

            console.log(`[BackgroundIndexer] Found ${files.length} files to index`);

            // Process in batches to avoid overwhelming the server
            const batchSize = 10;
            let indexed = 0;

            for (let i = 0; i < files.length; i += batchSize) {
                if (!this.serverClient.isConnected) {
                    console.warn('[BackgroundIndexer] Server disconnected, pausing...');
                    break;
                }

                const batch = files.slice(i, i + batchSize);
                await Promise.allSettled(
                    batch.map((uri) => this.indexFile(uri, workspacePath)),
                );

                indexed += batch.length;
                if (indexed % 50 === 0) {
                    console.log(`[BackgroundIndexer] Progress: ${indexed}/${files.length} files`);
                }
            }

            console.log(`[BackgroundIndexer] Full index complete: ${indexed} files processed`);
        } catch (error) {
            console.error('[BackgroundIndexer] Full index failed:', error);
        } finally {
            this.indexingInProgress = false;
        }
    }

    /**
     * Indexes a single file by extracting its symbols and sending them to the server.
     */
    private async indexFile(uri: vscode.Uri, workspacePath: string): Promise<void> {
        try {
            const relativePath = vscode.workspace.asRelativePath(uri, false);

            // Try to extract symbols using VS Code's language services
            const symbols = await this.extractSymbols(uri);

            await this.serverClient.indexFile(workspacePath, relativePath, symbols);
        } catch (error) {
            // Silently skip files that can't be indexed (binary files, etc.)
        }
    }

    /**
     * Extracts document symbols from a file using VS Code's built-in
     * DocumentSymbolProvider (powered by TreeSitter/Language Server).
     */
    private async extractSymbols(
        uri: vscode.Uri,
    ): Promise<Array<{ name: string; kind: string; text: string }>> {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const rawSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri,
            );

            if (!rawSymbols || rawSymbols.length === 0) {
                // Fall back to indexing the whole file as a single symbol
                const text = doc.getText();
                if (text.length > 0 && text.length < 50000) {
                    return [{
                        name: uri.fsPath.split('/').pop() || 'file',
                        kind: 'file',
                        text: text.slice(0, 10000),
                    }];
                }
                return [];
            }

            const results: Array<{ name: string; kind: string; text: string }> = [];
            this.flattenSymbols(rawSymbols, doc, results);
            return results;
        } catch {
            return [];
        }
    }

    /**
     * Recursively flattens nested DocumentSymbols into a flat array.
     */
    private flattenSymbols(
        symbols: vscode.DocumentSymbol[],
        doc: vscode.TextDocument,
        results: Array<{ name: string; kind: string; text: string }>,
    ): void {
        for (const symbol of symbols) {
            const text = doc.getText(symbol.range);
            if (text.length >= 5 && text.length < 20000) {
                results.push({
                    name: symbol.name,
                    kind: vscode.SymbolKind[symbol.kind] || 'Unknown',
                    text,
                });
            }

            // Recurse into children
            if (symbol.children && symbol.children.length > 0) {
                this.flattenSymbols(symbol.children, doc, results);
            }
        }
    }

    /**
     * Sets up file watchers to re-index on save, create, and delete.
     */
    private setupFileWatchers(): void {
        // Re-index on save
        const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
            if (this.shouldIndexFile(doc.uri)) {
                const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspacePath && this.serverClient.isConnected) {
                    await this.indexFile(doc.uri, workspacePath);
                }
            }
        });

        // Index on file create
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,py,go,rs,java}');

        const onCreate = fileWatcher.onDidCreate(async (uri) => {
            if (this.shouldIndexFile(uri)) {
                const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspacePath && this.serverClient.isConnected) {
                    // Small delay to let file contents settle
                    setTimeout(() => this.indexFile(uri, workspacePath), 500);
                }
            }
        });

        // Delete index on file delete
        const onDelete = fileWatcher.onDidDelete(async (uri) => {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspacePath && this.serverClient.isConnected) {
                const relativePath = vscode.workspace.asRelativePath(uri, false);
                await this.serverClient.deleteIndexedFile(workspacePath, relativePath);
            }
        });

        this.disposables.push(onSave, fileWatcher, onCreate, onDelete);
    }

    /**
     * Checks if a file should be indexed based on its extension.
     */
    private shouldIndexFile(uri: vscode.Uri): boolean {
        const ext = uri.fsPath.substring(uri.fsPath.lastIndexOf('.'));
        return BackgroundIndexerService.SUPPORTED_EXTENSIONS.has(ext);
    }

    /**
     * Disposes all watchers and resources.
     */
    public dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
