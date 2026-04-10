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
    constructor(private readonly modelRegistry: ModelRegistryService) {
        super();
    }

    public id: string = 'glyph.model_select';

    public action = async () => {
        const items = await this.modelRegistry.getModelsForPicker();

        const selected = await vscode.window.showQuickPick<vscode.QuickPickItem>(items, {
            placeHolder: 'Switch model…',
            matchOnDescription: true,
        });

        if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
            return;
        }

        // Clean label (remove $(check) prefix if present)
        const cleanLabel = selected.label.replace(/^\$\(check\)\s*/, '');
        const providerType = selected.description?.trim();

        const entry = await this.modelRegistry.resolvePickerSelection(cleanLabel, providerType);
        if (entry) {
            await this.modelRegistry.switchToModel(entry);
            vscode.window.showInformationMessage(
                `Glyph: Switched to ${entry.name} (${entry.provider})`,
            );
        }
    };
}
