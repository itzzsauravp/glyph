import * as vscode from 'vscode';

export function ghostTextDecoration(text: string) {
    return vscode.window.createTextEditorDecorationType({
        after: {
            contentText: ` ${text}...`,
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
        }
    });
}