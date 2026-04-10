import * as vscode from 'vscode';
import { CLOUD_REGISTERY } from '../../constants';
import BaseCommand from '../core/base.command';

/**
 * Lets the user inspect and delete stored API keys.
 *
 * Options presented via QuickPick:
 *   • Delete the custom model key
 *   • Delete a specific cloud provider key
 *   • Delete ALL stored Glyph API keys at once
 */
export default class ManageApiKeys extends BaseCommand {
    public readonly id = 'glyph.manage_api_keys';

    constructor(private readonly context: vscode.ExtensionContext) {
        super();
    }

    /** All secret key identifiers that Glyph may have stored. */
    private get allSecretKeys(): { label: string; secretKey: string }[] {
        const providerKeys = Object.keys(CLOUD_REGISTERY).map((provider) => ({
            label: provider,
            secretKey: `glyph.apiKey.${provider.toLowerCase()}`,
        }));

        return [{ label: 'Custom Model', secretKey: 'glyph.apiKey.custom' }, ...providerKeys];
    }

    public action = async (): Promise<void> => {
        const DELETE_ALL = '$(trash) Delete ALL Glyph API Keys';

        const items: vscode.QuickPickItem[] = [
            ...this.allSecretKeys.map((entry) => ({
                label: `$(key) ${entry.label}`,
                description: entry.secretKey,
            })),
            { label: DELETE_ALL, kind: vscode.QuickPickItemKind.Separator },
            { label: DELETE_ALL },
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an API key to delete',
            title: 'Manage Glyph API Keys',
        });

        if (!selected) {
            return;
        }

        if (selected.label === DELETE_ALL) {
            await this.deleteAllKeys();
            return;
        }

        // Find the matching entry by the description field (which holds the secretKey)
        const entry = this.allSecretKeys.find((e) => e.secretKey === selected.description);
        if (!entry) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the API key for "${entry.label}"?`,
            { modal: true },
            'Delete',
        );

        if (confirm !== 'Delete') {
            return;
        }

        await this.context.secrets.delete(entry.secretKey);
        vscode.window.showInformationMessage(`API key for "${entry.label}" has been removed.`);
    };

    private async deleteAllKeys(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'This will delete ALL stored Glyph API keys. Continue?',
            { modal: true },
            'Delete All',
        );

        if (confirm !== 'Delete All') {
            return;
        }

        for (const entry of this.allSecretKeys) {
            await this.context.secrets.delete(entry.secretKey);
        }

        vscode.window.showInformationMessage('All Glyph API keys have been removed.');
    }
}
