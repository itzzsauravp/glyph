import * as vscode from "vscode";
import * as lancedb from "@lancedb/lancedb";
import OllamaService from "./ollama.service";

export default class RepositoryIndexerService {

    constructor(
        private readonly workspaceTable: lancedb.Table,
        private readonly ollamaService: OllamaService,
    ) {
    }

    public async indexFile(uri: vscode.Uri) {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );
            const promiseRows = symbols.map(async s => {
                const text = vscode.window.activeTextEditor?.document.getText(s.range);
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
                    vector,
                };
            });

            const rows = (await Promise.all(promiseRows)).filter(row => row !== null);
            console.log(rows);
        } catch (error) {
            console.error("repo-indexer: Error executing document symbol provider:", error);
        }
    }

}