import * as vscode from 'vscode';
import type { ModelRegistryService } from '../../services';
import BaseCommand from '../core/base.command';

/**
 * Command that opens a QuickPick populated from the unified model registry.
 *
 * Shows models from all sources — live provider, discovered local models,
 * registered cloud models, and recently used history — grouped by provider
 * with separators.
 */
export default class ModelSelect extends BaseCommand {
    constructor(
        private readonly modelRegistry: ModelRegistryService,
    ) {
        super();
    }

    public id: string = 'glyph.model_select';

    public action = async () => {
        const items = await this.modelRegistry.getModelsForPicker();

        const selected = await vscode.window.showQuickPick<vscode.QuickPickItem>(items, {
            placeHolder: 'Select a model',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
            return;
        }

        // Extract providerType from the description field for precise matching.
        const providerType = selected.description
            ?.replace(/^\$\(check\)\s*ACTIVE\s*\|\s*/, '')
            ?.trim();

        const entry = await this.modelRegistry.resolvePickerSelection(
            selected.label,
            providerType,
        );
        if (entry) {
            await this.modelRegistry.switchToModel(entry);
            vscode.window.showInformationMessage(
                `Glyph: Switched to ${entry.name} (${entry.provider})`,
            );
        }
    };
}
