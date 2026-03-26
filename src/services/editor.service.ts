import * as vscode from 'vscode';
import { ghostTextDecoration } from '../utils/editor.utils';

export async function readFileAsText(fileUri: vscode.Uri): Promise<string> {
    try {
        const rawData = await vscode.workspace.fs.readFile(fileUri);
        const decodedText = new TextDecoder().decode(rawData);

        return decodedText;
    } catch (error) {
        console.error(`Error reading file: ${error}`);
        return "";
    }
}

export function getSelectedText(): string | null {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        return null;
    }

    const selection = editor.selection;
    console.log("This is the selection:", selection)

    if (selection.isEmpty) {
        return "";
    }

    const selectedText = editor.document.getText(selection);

    return selectedText;
}

export async function showPromptInput() {
    const result = await vscode.window.showInputBox({
        placeHolder: "Explain this code...",
        prompt: "Enter instructions for the LLM",
        ignoreFocusOut: true
    });

    if (!result) {
        vscode.window.showErrorMessage("Prompt field cannot be null")
        return
    }

    return result;
}

export async function replaceSelectionAndFormat(newText: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const success = await editor.edit(editBuilder => {
        editBuilder.replace(editor.selection, newText);
    });

    if (success) {
        await vscode.commands.executeCommand('editor.action.formatSelection');

        vscode.window.showInformationMessage("AI code inserted and formatted!");
    }
}

export async function replaceEntireFile(newText: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;

    const firstLine = document.lineAt(0);
    const lastLine = document.lineAt(document.lineCount - 1);

    const fullRange = new vscode.Range(
        firstLine.range.start,
        lastLine.range.end
    );

    const success = await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, newText);
    });

    if (success) {
        await vscode.commands.executeCommand('editor.action.formatSelection');

        vscode.window.showInformationMessage("AI code inserted and formatted!");
    }
}