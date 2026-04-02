import * as vscode from 'vscode';
import type GlyphConfig from '../config/glyph.config';
import type StatusBarService from '../services/status-bar.service';
import BaseCommand from './base.command';

/**
 * Guides the user through setting up a custom (non-registry) model
 * by collecting the model name, base URL, and API key in one flow.
 *
 * The API key is stored securely via the VS Code SecretStorage API
 * under the key `glyph.apiKey.custom`.
 */
export default class SetupCustomModel extends BaseCommand {
    public readonly id = 'glyph.setup_custom_model';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly glyphConfig: GlyphConfig,
        private readonly statusBar: StatusBarService,
    ) {
        super();
    }

    public action = async (): Promise<void> => {
        // --- Step 1: Model name ---
        const modelName = await vscode.window.showInputBox({
            title: 'Custom Model Setup (1/3)',
            prompt: 'Enter the model identifier (e.g. my-fine-tuned-llama)',
            placeHolder: 'model-name',
            ignoreFocusOut: true,
        });

        if (!modelName) {
            return;
        }

        // --- Step 2: Base URL ---
        const baseUrl = await vscode.window.showInputBox({
            title: 'Custom Model Setup (2/3)',
            prompt: 'Enter the base URL for the model API',
            placeHolder: 'https://api.example.com/v1/chat/completions',
            value: 'http://localhost:11434',
            ignoreFocusOut: true,
        });

        if (!baseUrl) {
            return;
        }

        // --- Step 3: API Key ---
        const apiKey = await vscode.window.showInputBox({
            title: 'Custom Model Setup (3/3)',
            prompt: 'Enter the API key for this model (leave blank if none is needed)',
            password: true,
            ignoreFocusOut: true,
        });

        // Cancelled (undefined) vs deliberately empty (empty string)
        if (apiKey === undefined) {
            return;
        }

        // Persist everything
        await this.glyphConfig.updateModel(modelName);
        await this.glyphConfig.updateEndpoint(baseUrl);

        if (apiKey.length > 0) {
            await this.context.secrets.store('glyph.apiKey.custom', apiKey);
        }

        this.statusBar.setModel(modelName);

        vscode.window.showInformationMessage(
            `Custom model "${modelName}" configured successfully.`,
        );
    };
}
