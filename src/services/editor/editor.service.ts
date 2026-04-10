import * as vscode from 'vscode';
import type GlyphConfig from '../../config/glyph.config';
import type EditorUIService from './editor-ui.service';

export default class EditorService {
    constructor(
        private readonly editorUI: EditorUIService,
        private readonly glyphConfig: GlyphConfig,
    ) {}

    /**
     * Reads the content of a file given its URI.
     */
    public readFileAsText = async (fileUri: vscode.Uri): Promise<string> => {
        try {
            const rawData = await vscode.workspace.fs.readFile(fileUri);
            return new TextDecoder().decode(rawData);
        } catch (error) {
            console.error(`Error reading file: ${error}`);
            return '';
        }
    };

    /**
     * Shows a QuickInput overlay to get a prompt from the user.
     * This opens at the top-center of VS Code.
     */
    public showPromptInput = async (): Promise<string | undefined> => {
        return new Promise<string | undefined>((resolve) => {
            const input = vscode.window.createInputBox();
            input.title = 'Glyph AI Prompt';
            input.placeholder = 'Explain this code...';
            input.prompt = 'Enter instructions for the LLM. Press Enter to submit.';
            input.ignoreFocusOut = true;

            input.onDidAccept(() => {
                const value = input.value.trim();
                if (!value) {
                    vscode.window.showErrorMessage('Prompt field cannot be empty');
                    return;
                }
                resolve(value);
                input.hide();
            });

            input.onDidHide(() => {
                resolve(undefined);
                input.dispose();
            });

            input.show();
        });
    };

    /**
     * Silently formats a range in a document without stealing focus or selection.
     */
    private async formatRangeSilently(fileUri: vscode.Uri, range: vscode.Range) {
        const document = await vscode.workspace.openTextDocument(fileUri);
        const options: vscode.FormattingOptions = {
            tabSize: 4,
            insertSpaces: true,
        };

        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatRangeProvider',
            document.uri,
            range,
            options,
        );

        if (edits && edits.length > 0) {
            const formatEdit = new vscode.WorkspaceEdit();
            formatEdit.set(document.uri, edits);
            await vscode.workspace.applyEdit(formatEdit);
        }
    }

    /**
     * Replaces text in a file and formats silently without disrupting the user's workflow.
     * @param fileUri File where the replacement will happen.
     * @param range The range of the original code.
     * @param data The code response from the LLM.
     */
    public async replaceAndFormat(fileUri: vscode.Uri, range: vscode.Range, data: string) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(fileUri, range, data);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            const dataLines = data.split('\n').length;
            const formattedRange = new vscode.Range(
                range.start,
                new vscode.Position(range.start.line + dataLines, 0),
            );
            await this.formatRangeSilently(fileUri, formattedRange);
            await this.conditionalSave(fileUri);
        }
    }

    /**
     * Inserts text before a range and formats silently without disrupting the user's workflow.
     * @param fileUri File where the insertion will happen.
     * @param range The range before which docs will be inserted.
     * @param data The documentation response from the LLM.
     */
    public async insertAndFormat(fileUri: vscode.Uri, range: vscode.Range, data: string) {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(fileUri, range.start, `${data}\n`);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            const docLines = data.split('\n').length;
            const docRange = new vscode.Range(range.start.line, 0, range.start.line + docLines, 0);
            await this.formatRangeSilently(fileUri, docRange);
            await this.conditionalSave(fileUri);
        }
    }

    private async conditionalSave(fileUri: vscode.Uri) {
        const { autoSave } = this.glyphConfig.getExtensionConfig();
        if (autoSave) {
            const document = await vscode.workspace.openTextDocument(fileUri);
            await document.save();
        }
    }

    async findFunctionRange(editor: vscode.TextEditor): Promise<vscode.Range | undefined> {
        const selection = editor.selection;

        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            editor.document.uri,
        );

        if (!symbols) {
            return undefined;
        }

        const findTarget = (syms: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined => {
            for (const sym of syms) {
                if (sym.range.contains(selection.start)) {
                    if (
                        sym.kind === vscode.SymbolKind.Function ||
                        sym.kind === vscode.SymbolKind.Method
                    ) {
                        return sym;
                    }
                    if (sym.children.length > 0) {
                        const child = findTarget(sym.children);
                        if (child) {
                            return child;
                        }
                    }
                }
            }
            return undefined;
        };

        const target = findTarget(symbols);
        return target?.range;
    }
}
