import * as vscode from 'vscode';

export default class EditorUIService {
    private activeLoadingDecoration: vscode.TextEditorDecorationType | undefined;
    private animationInterval: NodeJS.Timeout | undefined;

    /**
     * Shows a "ghost text" decoration in the editor to indicate loading/generation.
     */
    public showLoadingGhostText(editor: vscode.TextEditor, baseText: string = "Generating", customPosition?: vscode.Position) {
        this.clearGhostText();

        const frames = [".  ", ".. ", "...", " ..", "  ."];
        let step = 0;

        this.animationInterval = setInterval(() => {
            if (this.activeLoadingDecoration) {
                this.activeLoadingDecoration.dispose();
            }

            this.activeLoadingDecoration = vscode.window.createTextEditorDecorationType({
                after: {
                    contentText: ` ${baseText}${frames[step]}`,
                    color: 'rgba(128, 128, 128, 0.2)',
                    fontStyle: 'italic',
                    margin: '0 0 0 1ch'
                }
            });

            const position = customPosition || editor.selection.active;
            const range = new vscode.Range(position, position);
            editor.setDecorations(this.activeLoadingDecoration, [range]);

            step = (step + 1) % frames.length;
        }, 300);
    }

    /**
     * Clears any active ghost text decoration.
     */
    public clearGhostText() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = undefined;
        }
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