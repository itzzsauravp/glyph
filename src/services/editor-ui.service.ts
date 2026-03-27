import * as vscode from 'vscode';

export default class EditorUIService {
    private activeLoadingDecoration: vscode.TextEditorDecorationType | undefined;

    /**
     * Shows a "ghost text" decoration in the editor to indicate loading/generation.
     */
    public showLoadingGhostText(editor: vscode.TextEditor, text: string = "Generating") {
        if (this.activeLoadingDecoration) {
            this.activeLoadingDecoration.dispose();
        }

        this.activeLoadingDecoration = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ` ${text}...`,
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontStyle: 'italic',
            }
        });

        const position = editor.selection.active;
        const range = new vscode.Range(position, position);

        editor.setDecorations(this.activeLoadingDecoration, [range]);
    }

    /**
     * Clears any active ghost text decoration.
     */
    public clearGhostText() {
        if (this.activeLoadingDecoration) {
            this.activeLoadingDecoration.dispose();
            this.activeLoadingDecoration = undefined;
        }
    }

    /**
     * Gets the selected text from the active editor.
     * Returns an empty string if nothing is selected.
     */
    public getSelectedText(editor: vscode.TextEditor): string {
        const selection = editor.selection;
        if (selection.isEmpty) {
            return "";
        }
        return editor.document.getText(selection);
    }

    /**
     * Gets the full range of the document in the given editor.
     */
    public getFullFileRange(editor: vscode.TextEditor): vscode.Range {
        const document = editor.document;
        const firstLine = document.lineAt(0);
        const lastLine = document.lineAt(document.lineCount - 1);
        return new vscode.Range(firstLine.range.start, lastLine.range.end);
    }
}