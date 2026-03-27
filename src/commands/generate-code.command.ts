import * as vscode from "vscode";
import BaseCommand from "./base.command";
import EditorService from "../services/editor.service";
import OllamaService from "../services/ollama.service";
import EditorUIService from "../services/editor-ui.service";

export default class GenerateCode extends BaseCommand {

    constructor(
        private readonly editorService: EditorService,
        private readonly ollamaService: OllamaService,
        private readonly editorUI: EditorUIService
    ) {
        super()
    }

    public id: string = "glyph.code";

    public action = async (): Promise<void> => {

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const savedUri = editor.document.uri;
        const savedRange = editor.selection;

        const prompt = await this.editorService.showPromptInput();
        if (!prompt) return;

        let codeContext: string;
        const selectedText = this.editorUI.getSelectedText(editor);

        if (selectedText) {
            codeContext = selectedText;
        } else {
            codeContext = await this.editorService.readFileAsText(editor.document.uri);
        }

        try {
            this.editorUI.showLoadingGhostText(editor, "Generating");

            const resultFromLLM = await this.ollamaService.generateCode(prompt as string, codeContext);

            await this.editorService.replaceAndFormat(savedUri, savedRange, resultFromLLM);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as any).message);
        } finally {
            this.editorUI.clearGhostText();
        }
    }

}