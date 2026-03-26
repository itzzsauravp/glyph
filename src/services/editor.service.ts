import * as vscode from 'vscode';
import { getFullFileRange, getSelectedText } from '../utils/editor.utils';

export default class EditorService {

    constructor() { }

    /**
     * Reads the content of a file given its URI.
     */
    public readFileAsText = async (fileUri: vscode.Uri): Promise<string> => {
        try {
            const rawData = await vscode.workspace.fs.readFile(fileUri);
            return new TextDecoder().decode(rawData);
        } catch (error) {
            console.error(`Error reading file: ${error}`);
            return "";
        }
    }

    /**
     * Shows an input box to get a prompt from the user.
     */
    public showPromptInput = async (): Promise<string | undefined> => {
        const result = await vscode.window.showInputBox({
            placeHolder: "Explain this code...",
            prompt: "Enter instructions for the LLM",
            ignoreFocusOut: true
        });

        if (!result) {
            vscode.window.showErrorMessage("Prompt field cannot be empty");
            return;
        }

        return result;
    }

    /**
     * Replaces the current selection with new text and formats it.
     */
    public replaceSelectionAndFormat = async (newText: string) => {
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

    /**
     * Replaces the entire document content with new text and formats it.
     */
    public replaceEntireFile = async (newText: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const fullRange = getFullFileRange(editor);

        const success = await editor.edit(editBuilder => {
            editBuilder.replace(fullRange, newText);
        });

        if (success) {
            await vscode.commands.executeCommand('editor.action.formatSelection');
            vscode.window.showInformationMessage("AI code inserted and formatted!");
        }
    }

    /**
     * Inserts the generated documentation directly above the current selection.
     */
    public insertDocumentation = async (docString: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;

        const insertPosition = selection.start;

        const success = await editor.edit(editBuilder => {
            editBuilder.insert(insertPosition, `${docString}\n`);
        });

        if (success) {
            await vscode.commands.executeCommand('editor.action.formatDocument');
            vscode.window.showInformationMessage("Documentation generated and inserted!");
        }
    }


    /**
     * Gets the selected text from the active editor.
     * @deprecated Use getSelectedText from editor.utils.ts directly if you have access to the editor object.
     */
    public getSelectedTextFromActiveEditor = (): string | null => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return null;
        return getSelectedText(editor);
    }
}
