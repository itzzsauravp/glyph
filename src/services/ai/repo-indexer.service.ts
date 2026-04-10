import crypto from 'node:crypto';
import type * as lancedb from '@lancedb/lancedb';
import { tree } from 'tree-node-cli';
import * as vscode from 'vscode';
import type { LLMService } from '../index';

/**
 * Indexes document symbols (functions, classes, types, etc.) from files
 * into the LanceDB workspace table as vector embeddings.
 *
 * Uses per-symbol SHA-256 hashing to detect changes: unchanged symbols
 * are skipped entirely, saving expensive embedding API calls.
 */
export default class RepositoryIndexerService {
    constructor(
        private readonly workspaceTable: lancedb.Table,
        private readonly llmService: LLMService,
    ) {}

    /**
     * Computes a SHA-256 hex digest of the given text.
     */
    private hashText(text: string): string {
        return crypto.createHash('sha256').update(text).digest('hex');
    }

    /**
     * Queries the LanceDB table for all existing rows for a file path
     * and returns a Map of symbolName → symbolHash for fast lookup.
     */
    private async getExistingSymbols(filePath: string): Promise<Map<string, string>> {
        const existing = new Map<string, string>();
        try {
            const rows = await this.workspaceTable
                .search(new Float32Array(768).fill(0))
                .where(`path = '${filePath}' AND text != 'seed_marker' `)
                .limit(1000)
                .toArray();

            for (const row of rows) {
                existing.set(row.symbolName as string, row.symbolHash as string);
            }
        } catch (_error) {
            // Table may be empty or filter may match nothing — both are fine.
        }
        return existing;
    }

    /**
     * Deletes a specific symbol row from the table by path + symbolName.
     */
    private async deleteSymbol(filePath: string, symbolName: string): Promise<void> {
        try {
            await this.workspaceTable.delete(
                `path = '${filePath}' AND symbolName = '${symbolName}'`,
            );
        } catch (_error) {
            // Nothing to delete — fine.
        }
    }

    /**
     * Returns a tree-like directory representation for the active workspace.
     */
    public parseDirectoryStructure(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceFolder) {
            console.error('[RepoIndexer]: No workspace folder found to parse');
            return '';
        }

        return tree(workspaceFolder, {
            allFiles: true,
            exclude: [/node_modules/, /\.git/, /\.glyph/, /dist/, /out/],
            maxDepth: Infinity,
            trailingSlash: true,
        });
    }

    /**
     * Indexes one or more files. Accepts a single URI or an array of URIs.
     *
     * For each file:
     * 1. Extracts symbols via VS Code's DocumentSymbolProvider.
     * 2. Computes a SHA-256 hash of each symbol's text.
     * 3. Compares against stored hashes — skips unchanged symbols.
     * 4. Re-embeds and upserts only changed or new symbols.
     * 5. Removes rows for symbols that no longer exist in the file.
     */
    public async indexFile(uri: vscode.Uri | vscode.Uri[]): Promise<void> {
        const uris = Array.isArray(uri) ? uri : [uri];

        for (const fileUri of uris) {
            await this.indexSingleFile(fileUri);
        }
    }

    /**
     * Core indexing logic for a single file with hash-based change detection.
     */
    private async indexSingleFile(uri: vscode.Uri): Promise<void> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri,
            );

            if (!symbols || symbols.length === 0) {
                console.warn(`[RepoIndexer] No symbols found for ${uri.fsPath}`);
                return;
            }

            const document = await vscode.workspace.openTextDocument(uri);
            const existingSymbols = await this.getExistingSymbols(uri.fsPath);

            // Track which symbols we've seen in this pass — anything left in
            // existingSymbols afterward is a deleted symbol that needs cleanup.
            const seenSymbols = new Set<string>();
            const newRows = [];

            for (const s of symbols) {
                const text = document.getText(s.range);
                if (!text) {
                    console.warn(
                        `[RepoIndexer] Skipping symbol "${s.name}" — no text could be extracted.`,
                    );
                    continue;
                }

                seenSymbols.add(s.name);
                const newHash = this.hashText(text);
                const existingHash = existingSymbols.get(s.name);

                // Hash unchanged — skip expensive embedding call.
                if (existingHash === newHash) {
                    continue;
                }

                // Hash changed or new symbol — delete old row (if any) and re-embed.
                if (existingHash) {
                    await this.deleteSymbol(uri.fsPath, s.name);
                    console.log(`[RepoIndexer] Re-indexing changed symbol: ${s.name}`);
                } else {
                    console.log(`[RepoIndexer] Indexing new symbol: ${s.name}`);
                }

                const vector = await this.llmService.generateEmbeddings(text);

                newRows.push({
                    text,
                    symbolName: s.name,
                    text_type: vscode.SymbolKind[s.kind].toLowerCase(),
                    path: uri.fsPath,
                    vector: new Float32Array(vector),
                    symbolHash: newHash,
                    lastIndexed: new Date().toISOString(),
                });
            }

            // Clean up symbols that were removed from the file.
            for (const [oldSymbolName] of existingSymbols) {
                if (!seenSymbols.has(oldSymbolName)) {
                    await this.deleteSymbol(uri.fsPath, oldSymbolName);
                    console.log(`[RepoIndexer] Removed deleted symbol: ${oldSymbolName}`);
                }
            }

            if (newRows.length > 0) {
                await this.workspaceTable.add(newRows);
                console.log(
                    `[RepoIndexer] Indexed ${newRows.length} changed/new symbols in ${uri.fsPath}`,
                );
            } else {
                console.log(`[RepoIndexer] All symbols up-to-date in ${uri.fsPath}`);
            }
        } catch (error) {
            console.error(`[RepoIndexer] Error indexing file ${uri.fsPath}:`, error);
        }
    }
}
