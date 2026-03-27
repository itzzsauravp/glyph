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
        let selectedEntireFile: boolean = false;


        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const prompt = await this.editorService.showPromptInput();
        if (!prompt) return;

        let codeContext: string;
        const selectedText = this.editorUI.getSelectedText(editor);

        if (selectedText) {
            codeContext = selectedText;
            vscode.window.showInformationMessage("Read selected text.");
        } else {
            selectedEntireFile = true;
            codeContext = await this.editorService.readFileAsText(editor.document.uri);
            vscode.window.showInformationMessage("Read entire file.");
        }

        try {
            this.editorUI.showLoadingGhostText(editor, "Generating");

            const resultFromLLM = await this.ollamaService.generateCode(prompt as string, codeContext);

            selectedEntireFile ?
                await this.editorService.replaceEntireFile(resultFromLLM) :
                await this.editorService.replaceSelectionAndFormat(resultFromLLM);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as any).message);
        } finally {
            this.editorUI.clearGhostText();
        }
    }

}