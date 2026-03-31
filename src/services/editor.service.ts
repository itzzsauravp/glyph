import * as vscode from 'vscode';
import EditorUIService from './editor-ui.service';

export default class EditorService {

    constructor(private readonly editorUI: EditorUIService) { }

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
     * 
     * @param fileUri File where the generate and replace is going to happen.
     * @param range The range of the original code Ex: line 1 to 32.
     * @param data The code respose from the LLM.
     */
    public async replaceAndFormat(fileUri: vscode.Uri, range: vscode.Range, data: string) {
        const edit = new vscode.WorkspaceEdit();

        edit.replace(fileUri, range, data);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document);

            editor.selection = new vscode.Selection(range.start, range.end);
            await vscode.commands.executeCommand('editor.action.formatSelection');

            await document.save();
        }
    }

    /**
     * 
     * @param fileUri File where the generate and replace is going to happen.
     * @param range The range of the original code Ex: line 1 to 32.
     * @param data The code respose from the LLM.
     */
    public async insertAndFormat(fileUri: vscode.Uri, range: vscode.Range, data: string) {
        const edit = new vscode.WorkspaceEdit();

        edit.insert(fileUri, range.start, data + "\n");

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document);

            const docLines = data.split('\n').length;
            const docRange = new vscode.Range(
                range.start.line, 0,
                range.start.line + docLines, 0
            );

            editor.selection = new vscode.Selection(docRange.start, docRange.end);
            await vscode.commands.executeCommand('editor.action.formatSelection');
        }
    }

    async findFunctionRange(editor: vscode.TextEditor): Promise<vscode.Range | undefined> {
        const selection = editor.selection;

        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            editor.document.uri
        );

        if (!symbols) return undefined;

        const findTarget = (syms: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined => {
            for (const sym of syms) {
                if (sym.range.contains(selection.start)) {
                    if (sym.kind === vscode.SymbolKind.Function || sym.kind === vscode.SymbolKind.Method) {
                        return sym;
                    }
                    if (sym.children.length > 0) {
                        const child = findTarget(sym.children);
                        if (child) return child;
                    }
                }
            }
            return undefined;
        };

        const target = findTarget(symbols);
        return target?.range;
    }

}