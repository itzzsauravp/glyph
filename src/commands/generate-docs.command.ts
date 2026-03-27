import * as vscode from "vscode";
import BaseCommand from "./base.command";
import EditorService from "../services/editor.service";
import OllamaService from "../services/ollama.service";
import EditorUIService from "../services/editor-ui.service";

export default class GenerateDocs extends BaseCommand {

    constructor(
        private readonly editorService: EditorService,
        private readonly ollamaService: OllamaService,
        private readonly editorUI: EditorUIService
    ) {
        super()
    }

    public id: string = "glyph.docs";

    public action = async (): Promise<void> => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const savedUri = editor.document.uri;
        const savedRange = editor.selection;

        let codeContext: string;
        const selectedText = this.editorUI.getSelectedText(editor);

        if (selectedText) {
            codeContext = selectedText;
        } else {
            vscode.window.showWarningMessage("Please mark a selection to document");
            return;
        }

        try {
            this.editorUI.showLoadingGhostText(editor, "Generating");

            const resultFromLLM = await this.ollamaService.generateDocs(codeContext, editor.document.languageId);

            await this.editorService.insertAndFormat(savedUri, savedRange, resultFromLLM);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as any).message);
        } finally {
            this.editorUI.clearGhostText();
        }
    }

}