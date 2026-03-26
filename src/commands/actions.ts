import * as vscode from "vscode";
import { readFileAsText, replaceEntireFile, replaceSelectionAndFormat, showPromptInput } from "../services/editor.service";
import OllamaService from "../providers/llm/Ollama";

/**
 * Health check type command to test whether the extension is running.
 */
export function glyphTest() {
    vscode.window.showInformationMessage('Hey there!!!\nThis is a Starter test command for glyph');
}

/**
 *  Class the selected model to complete the given task 
 * changes and updates the codes for the selected area
 */
export async function glyphCodeGenerator() {
    let selectedEntireFile: boolean = false;

    const ollam = new OllamaService();
    const prompt = await showPromptInput();

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let codeContext: string;
    const selection = editor.selection;

    if (!selection.isEmpty) {
        codeContext = editor.document.getText(selection);
        vscode.window.showInformationMessage("Read selected text.");
    } else {
        selectedEntireFile = true;
        codeContext = await readFileAsText(editor.document.uri);
        vscode.window.showInformationMessage("Read entire file.");
    }

    try {

        const resultFromLLM = await ollam.generate(prompt as string, codeContext);
        selectedEntireFile ? replaceEntireFile(resultFromLLM) : replaceSelectionAndFormat(resultFromLLM);

    } catch (error) {

        console.error(error)
        vscode.window.showErrorMessage((error as any).message)

    }
}