import * as vscode from "vscode";
import EditorService from "../services/editor.service";
import OllamaService from "../providers/llm/Ollama";
import { clearGhostText, getSelectedText, showLoadingGhostText } from "../utils/editor.utils";

/**
 * GlyphActions is a class that contains all the command actions required for glyph to operate
 */
export default class GlyphActions {

    constructor(
        private readonly editorService: EditorService,
        private readonly ollama: OllamaService,
    ) {
    }

    /**
     * Health check type command to test whether the extension is running.
     * Only used while in development
     */
    public _test = () => {
        vscode.window.showInformationMessage('Hey there!!!\nThis is a Starter test command for glyph');
    }

    /**
     * This method uses a model to generate code
     * 
     * NOTE: use for existing code block, use it when needed to refactor a code
     */
    public generateCode = async () => {
        let selectedEntireFile: boolean = false;


        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const prompt = await this.editorService.showPromptInput();
        if (!prompt) return;

        let codeContext: string;
        const selectedText = getSelectedText(editor);

        if (selectedText) {
            codeContext = selectedText;
            vscode.window.showInformationMessage("Read selected text.");
        } else {
            selectedEntireFile = true;
            codeContext = await this.editorService.readFileAsText(editor.document.uri);
            vscode.window.showInformationMessage("Read entire file.");
        }

        try {
            showLoadingGhostText(editor, "Generating");

            const resultFromLLM = await this.ollama.generateCode(prompt as string, codeContext);

            selectedEntireFile ?
                await this.editorService.replaceEntireFile(resultFromLLM) :
                await this.editorService.replaceSelectionAndFormat(resultFromLLM);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as any).message);
        } finally {
            clearGhostText();
        }
    }

    public generateDocs = async () => {

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        let codeContext: string;
        const selectedText = getSelectedText(editor);

        if (selectedText) {
            codeContext = selectedText;
            vscode.window.showInformationMessage("Read selected text.");
        } else {
            vscode.window.showWarningMessage("Please mark a selection to document");
            return;
        }

        try {
            showLoadingGhostText(editor, "Generating");

            const resultFromLLM = await this.ollama.generateDocs(codeContext, editor.document.languageId);

            await this.editorService.insertDocumentation(resultFromLLM);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as any).message);
        } finally {
            clearGhostText();
        }
    }
}
