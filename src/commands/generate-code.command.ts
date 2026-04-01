import * as vscode from "vscode";
import BaseCommand from "./base.command";
import EditorService from "../services/editor.service";
import OllamaService from "../services/ollama.service";
import EditorUIService from "../services/editor-ui.service";
import StatusBarService, { StatusState } from "../services/status-bar.service";
import RangeTrackerService from "../services/range-tracker.service";

export default class GenerateCode extends BaseCommand {

    constructor(
        private readonly editorService: EditorService,
        private readonly ollamaService: OllamaService,
        private readonly editorUI: EditorUIService,
        private readonly statusBar: StatusBarService,
        private readonly rangeTracker: RangeTrackerService
    ) {
        super()
    }

    public id: string = "glyph.code";

    public action = async (): Promise<void> => {

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const savedUri = editor.document.uri;
        let savedRange: vscode.Range = editor.selection;

        const prompt = await this.editorService.showPromptInput();
        if (!prompt) return;

        if (savedRange.isSingleLine) {
            const funcRange = await this.editorService.findFunctionRange(editor);
            if (funcRange) {
                savedRange = funcRange;
            }
        }

        let codeContext = editor.document.getText(savedRange);

        if (!codeContext) {
            codeContext = await this.editorService.readFileAsText(editor.document.uri);
            savedRange = this.editorUI.getFullFileRange(editor);
        }

        const trackerId = this.rangeTracker.register(savedUri, savedRange);
        let tempTrackerId: string | undefined;

        try {
            this.statusBar.setState(StatusState.GeneratingCode);

            const startPos = (this.rangeTracker.getRange(trackerId) || savedRange).start;

            const tempEdit = new vscode.WorkspaceEdit();
            tempEdit.insert(savedUri, startPos, "\n");
            await vscode.workspace.applyEdit(tempEdit);

            tempTrackerId = this.rangeTracker.register(savedUri, new vscode.Range(startPos, startPos));

            this.editorUI.showLoadingGhostText(editor, "Generating", startPos);

            const resultFromLLM = await this.ollamaService.generateCode(prompt as string, codeContext, editor.document.languageId);

            const tempRange = this.rangeTracker.getRange(tempTrackerId);
            if (tempRange) {
                const cleanupEdit = new vscode.WorkspaceEdit();
                cleanupEdit.delete(savedUri, new vscode.Range(tempRange.start, new vscode.Position(tempRange.start.line + 1, 0)));
                await vscode.workspace.applyEdit(cleanupEdit);
            }

            const finalRange = this.rangeTracker.getRange(trackerId) || savedRange;
            await this.editorService.replaceAndFormat(savedUri, finalRange, resultFromLLM);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as any).message);
        } finally {
            if (tempTrackerId) this.rangeTracker.unregister(tempTrackerId);
            this.rangeTracker.unregister(trackerId);
            this.editorUI.clearGhostText();
            this.statusBar.setState(StatusState.Idle);
        }
    }

}