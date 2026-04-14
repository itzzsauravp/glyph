import * as vscode from 'vscode';
import {
    type EditorService,
    type EditorUIService,
    type LLMService,
    type RangeTrackerService,
    type RepositoryIndexerService,
    type StatusBarService,
    StatusState,
} from '../../services';
import BaseCommand from '../core/base.command';

export default class GenerateCode extends BaseCommand {
    constructor(
        private readonly editorService: EditorService,
        private readonly llmService: LLMService,
        private readonly editorUI: EditorUIService,
        private readonly statusBar: StatusBarService,
        private readonly rangeTracker: RangeTrackerService,
        private readonly repositoryIndexer: RepositoryIndexerService,
    ) {
        super();
    }

    public id: string = 'glyph.code';

    public action = async (): Promise<void> => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const savedUri = editor.document.uri;
        let savedRange: vscode.Range = editor.selection;

        const prompt = await this.editorService.showPromptInput();
        if (!prompt) {
            return;
        }

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
            tempEdit.insert(savedUri, startPos, '\n');
            await vscode.workspace.applyEdit(tempEdit);

            tempTrackerId = this.rangeTracker.register(
                savedUri,
                new vscode.Range(startPos, startPos),
            );

            this.editorUI.showLoadingGhostText(editor, 'Generating', startPos);

            // Hybrid execution: use tool-based code reading for capable models, RAG for others
            let resultFromLLM: string;
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const supportsTools = workspaceRoot ? await this.llmService.testToolCallSupport() : false;

            if (supportsTools) {
                resultFromLLM = await this.llmService.generateCodeWithTools(
                    prompt,
                    codeContext,
                    editor.document.languageId,
                    workspaceRoot,
                );
            } else {
                resultFromLLM = await this.llmService.generateWithProjectContext(
                    prompt,
                    codeContext,
                    editor.document.languageId,
                    this.repositoryIndexer,
                );
            }

            const tempRange = this.rangeTracker.getRange(tempTrackerId);
            if (tempRange) {
                const cleanupEdit = new vscode.WorkspaceEdit();
                cleanupEdit.delete(
                    savedUri,
                    new vscode.Range(
                        tempRange.start,
                        new vscode.Position(tempRange.start.line + 1, 0),
                    ),
                );
                await vscode.workspace.applyEdit(cleanupEdit);
            }

            const finalRange = this.rangeTracker.getRange(trackerId) || savedRange;
            await this.editorService.replaceAndFormat(savedUri, finalRange, resultFromLLM);
        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage((error as Error).message);
        } finally {
            if (tempTrackerId) {
                this.rangeTracker.unregister(tempTrackerId);
            }
            this.rangeTracker.unregister(trackerId);
            this.editorUI.clearGhostText();
            this.statusBar.setState(StatusState.Idle);
        }
    };
}
