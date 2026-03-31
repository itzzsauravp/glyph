import * as vscode from "vscode";
import BaseCommand from "./base.command";
import EditorService from "../services/editor.service";
import OllamaService from "../services/ollama.service";
import EditorUIService from "../services/editor-ui.service";

export default class GenerateDocs extends BaseCommand {

    constructor(
        private readonly editorService: EditorService,
        private readonly ollamaService: OllamaService,
        private readonly editorUI: EditorUIService
    ) {
        super()
    }

    public id: string = "glyph.docs";

    public action = async (): Promise<void> => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const savedUri = editor.document.uri;
        let savedRange: vscode.Range = editor.selection;

        if (savedRange.isSingleLine) {
            const funcRange = await this.editorService.findFunctionRange(editor);
            if (funcRange) {
                savedRange = funcRange;
            }
        }

        const codeContext = editor.document.getText(savedRange);

        if (!codeContext) {
            vscode.window.showWarningMessage("Please completely highlight text or functions name");
            return;
        }

        try {
            const tempEdit = new vscode.WorkspaceEdit();
            tempEdit.insert(savedUri, savedRange.start, "\n");
            await vscode.workspace.applyEdit(tempEdit);

            this.editorUI.showLoadingGhostText(editor, "Generating", savedRange.start);

            const resultFromLLM = await this.ollamaService.generateDocs(codeContext, editor.document.languageId);

            const cleanupEdit = new vscode.WorkspaceEdit();
            const tempNewlineRange = new vscode.Range(
                savedRange.start,
                new vscode.Position(savedRange.start.line + 1, 0)
            );
            cleanupEdit.delete(savedUri, tempNewlineRange);
            await vscode.workspace.applyEdit(cleanupEdit);

            await this.editorService.insertAndFormat(savedUri, savedRange, resultFromLLM);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as any).message);
        } finally {
            this.editorUI.clearGhostText();
        }
    }

}