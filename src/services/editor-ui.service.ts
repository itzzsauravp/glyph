import * as vscode from 'vscode';

export default class EditorUIService {
    private animationInterval: NodeJS.Timeout | undefined;
    private activeEditor: vscode.TextEditor | undefined;
    private startTime: number | undefined;

    // Create the decoration type exactly ONCE to prevent Editor/IPC freezing
    private ghostTextDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('editorGhostText.foreground'), // use native ghost text color
            fontStyle: 'italic',
            margin: '0 0 0 1ch',
        },
    });

    /**
     * Formats elapsed milliseconds into a human-readable string.
     * Under 60s → "12s", 60s+ → "1m 3s"
     */
    private formatElapsed(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        if (totalSeconds < 60) {
            return `${totalSeconds}s`;
        }
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }

    /**
     * Shows an animated "ghost text" decoration without freezing the editor.
     * The decoration position is captured once at call time so that subsequent
     * setDecorations calls do not interfere with cursor movement.
     *
     * An elapsed timer is displayed alongside the animation (e.g. "Generating... (12s)").
     */
    public showLoadingGhostText(
        editor: vscode.TextEditor,
        baseText: string = 'Generating',
        customPosition?: vscode.Position,
    ) {
        this.clearGhostText();
        this.activeEditor = editor;
        this.startTime = Date.now();

        // Only trailing-padded frames — no leading spaces that VS Code could collapse.
        const frames = ['.  ', '.. ', '...'];
        let step = 0;

        // Pin the position once — the cursor is free to move independently.
        const pinnedPosition = customPosition || editor.selection.active;
        const range = new vscode.Range(pinnedPosition, pinnedPosition);

        this.animationInterval = setInterval(() => {
            const elapsed = this.formatElapsed(Date.now() - this.startTime!);

            // Timer placed before dots so any trailing-space width variance
            // never shifts the elapsed counter left/right.
            const decorationOptions: vscode.DecorationOptions = {
                range: range,
                renderOptions: {
                    after: { contentText: ` ${baseText} (${elapsed})${frames[step]}` },
                },
            };

            editor.setDecorations(this.ghostTextDecorationType, [decorationOptions]);

            step = (step + 1) % frames.length;
        }, 300);
    }

    /**
     * Clears any active ghost text decoration and resets the elapsed timer.
     */
    public clearGhostText() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = undefined;
        }
        this.startTime = undefined;
        if (this.activeEditor) {
            this.activeEditor.setDecorations(this.ghostTextDecorationType, []);
            this.activeEditor = undefined;
        }
    }

    /**
     * Gets the selected text from the active editor.
     * Returns an empty string if nothing is selected.
     */
    public getSelectedText(editor: vscode.TextEditor): string {
        const selection = editor.selection;
        if (selection.isEmpty) {
            return '';
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
