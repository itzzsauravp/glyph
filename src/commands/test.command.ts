import * as vscode from "vscode";
import BaseCommand from "./base.command";
import RepositoryIndexerService from "../services/repo-indexer.service";

export default class TestCommand extends BaseCommand {

    constructor(
        private readonly repositoryIndexer: RepositoryIndexerService,
    ) {
        super();
    }

    public id: string = "glyph.test";

    public action = async (): Promise<void> => {
        vscode.window.showInformationMessage('Hey there!!!\nThis is a Starter test command for glyph');

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            console.warn("From test commands: No active text editor found.");
            return;
        }

        const uri = editor.document.uri;

        if (!this.repositoryIndexer) {
            console.error("From test commands: repositoryIndexer is undefined.");
            return;
        }

        try {
            await this.repositoryIndexer.indexFile(uri);
        } catch (error) {
            console.error("From test commands: Error applying indexFile:", error);
        }
    }

}