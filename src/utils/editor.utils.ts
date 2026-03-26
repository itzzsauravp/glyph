import * as vscode from 'vscode';

let activeLoadingDecoration: vscode.TextEditorDecorationType | undefined;

/**
 * Shows a "ghost text" decoration in the editor to indicate loading/generation.
 */
export function showLoadingGhostText(editor: vscode.TextEditor, text: string = "Generating") {
    if (activeLoadingDecoration) {
        activeLoadingDecoration.dispose();
    }

    activeLoadingDecoration = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: ` ${text}...`,
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
        }
    });

    const position = editor.selection.active;
    const range = new vscode.Range(position, position);

    editor.setDecorations(activeLoadingDecoration, [range]);
}

/**
 * Clears any active ghost text decoration.
 */
export function clearGhostText() {
    if (activeLoadingDecoration) {
        activeLoadingDecoration.dispose();
        activeLoadingDecoration = undefined;
    }
}

/**
 * Gets the selected text from the active editor.
 * Returns an empty string if nothing is selected.
 */
export function getSelectedText(editor: vscode.TextEditor): string {
    const selection = editor.selection;
    if (selection.isEmpty) {
        return "";
    }
    return editor.document.getText(selection);
}

/**
 * Gets the full range of the document in the given editor.
 */
export function getFullFileRange(editor: vscode.TextEditor): vscode.Range {
    const document = editor.document;
    const firstLine = document.lineAt(0);
    const lastLine = document.lineAt(document.lineCount - 1);
    return new vscode.Range(firstLine.range.start, lastLine.range.end);
}