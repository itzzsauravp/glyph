import * as vscode from "vscode";
import * as lancedb from "@lancedb/lancedb";
import OllamaService from "./ollama.service";

/**
 * Indexes document symbols (functions, classes, types, etc.) from a file
 * into the LanceDB workspace table as vector embeddings.
 *
 * Before inserting new rows for a file, any existing rows for that path
 * are deleted to prevent stale duplicates.
 */
export default class RepositoryIndexerService {

    constructor(
        private readonly workspaceTable: lancedb.Table,
        private readonly ollamaService: OllamaService,
    ) { }

    /**
     * Removes all existing vector rows for the given file path so a
     * fresh re-index does not create duplicates.
     */
    private async clearFileVectors(filePath: string): Promise<void> {
        try {
            await this.workspaceTable.delete(`path = '${filePath}'`);
        } catch (error) {
            // Table may be empty or the filter may match nothing — both are fine.
            console.warn("[RepoIndexer] clearFileVectors — nothing to delete or error:", error);
        }
    }

    /**
     * Indexes every top-level document symbol in the file identified by `uri`.
     *
     * 1. Clears any previously stored vectors for this file path.
     * 2. Extracts symbols via VS Code's built-in DocumentSymbolProvider.
     * 3. Generates an embedding for each symbol's text.
     * 4. Persists the rows into the workspace LanceDB table.
     */
    public async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                uri,
            );

            if (!symbols || symbols.length === 0) {
                console.warn(`[RepoIndexer] No symbols found for ${uri.fsPath}`);
                return;
            }

            await this.clearFileVectors(uri.fsPath);

            const document = await vscode.workspace.openTextDocument(uri);

            const promiseRows = symbols.map(async (s) => {
                const text = document.getText(s.range);
                if (!text) {
                    console.warn(`[RepoIndexer] Skipping symbol "${s.name}" — no text could be extracted.`);
                    return null;
                }

                const vector = await this.ollamaService.generateEmbeddings(text);

                return {
                    text,
                    symbolName: s.name,
                    text_type: vscode.SymbolKind[s.kind].toLowerCase(),
                    path: uri.fsPath,
                    vector: new Float32Array(vector),
                };
            });

            const rows = (await Promise.all(promiseRows)).filter((row) => row !== null);

            if (rows.length > 0) {
                await this.workspaceTable.add(rows);
            }
        } catch (error) {
            console.error("[RepoIndexer] Error indexing file:", error);
        }
    }
}