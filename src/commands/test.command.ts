import * as vscode from 'vscode';
import type LLMService from '../services/llm.service';
import type RepositoryIndexerService from '../services/repo-indexer.service';
import BaseCommand from './base.command';

export default class TestCommand extends BaseCommand {
    constructor(
        private readonly llmService: LLMService,
        private readonly repoIndexer: RepositoryIndexerService,
    ) {
        super();
    }

    public id: string = 'glyph.test';

    public action = async (): Promise<void> => {
        vscode.window.showInformationMessage(
            'Hey there!!!\nThis is a Starter test command for glyph',
        );

        const val = await this.llmService.identifyRequiredFiles(
            'Just list all the files that you found.',
            this.repoIndexer.parseDirectoryStructure(),
        );

        console.log('The val is:', val);

        if (val && val.length > 0) {
            vscode.window.showInformationMessage(
                `Identified ${val.length} files: ${val.join(', ')}`,
            );
        } else {
            vscode.window.showWarningMessage('No files were identified or the check failed.');
        }
    };
}
