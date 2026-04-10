import * as vscode from 'vscode';
import { resolveAdapter } from '../../adapters';
import type GlyphConfig from '../../config/glyph.config';
import { CLOUD_REGISTERY } from '../../constants';
import type { StatusBarService } from '../../services';
import type { ICloudRegistery } from '../../types/llm.types';
import BaseCommand from '../core/base.command';

export class CloudProviderOrchestrator extends BaseCommand {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly statusBar: StatusBarService,
        private readonly glyphConfig: GlyphConfig,
    ) {
        super();
    }

    public id: string = 'glyph.cloud_provider_orchestrator';

    private readonly cloudRegistry: ICloudRegistery = CLOUD_REGISTERY;

    public action = async () => {
        const providerNames = Object.keys(this.cloudRegistry);
        const selectedProvider = await vscode.window.showQuickPick(providerNames, {
            placeHolder: 'Select a Cloud AI Provider',
        });
        if (!selectedProvider) {
            return;
        }

        const models =
            this.cloudRegistry[selectedProvider as keyof typeof this.cloudRegistry].models;
        const selectedModel = await vscode.window.showQuickPick(models, {
            placeHolder: `Select a ${selectedProvider} model tier`,
        });
        if (!selectedModel) {
            return;
        }

        const secretKey = `glyph.apiKey.${selectedProvider.toLowerCase()}`;
        let apiKey = await this.context.secrets.get(secretKey);

        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                prompt: `Enter your ${selectedProvider} API Key. Get it here: ${this.cloudRegistry[selectedProvider as keyof typeof this.cloudRegistry].helpLink}`,
                password: true,
                ignoreFocusOut: true,
            });

            if (!apiKey) {
                return;
            }
            await this.context.secrets.store(secretKey, apiKey);
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Verifying connection to ${selectedProvider}...`,
                cancellable: false,
            },
            async (_progress) => {
                const statusInfo = await this.verifyConnection(
                    selectedProvider,
                    selectedModel,
                    apiKey,
                );

                if (statusInfo) {
                    vscode.window.showInformationMessage(statusInfo);
                } else {
                    vscode.window.showErrorMessage(
                        `Failed to connect to ${selectedProvider}. Please check your API key.`,
                    );
                    await this.context.secrets.delete(secretKey);
                }
            },
        );
    };

    /**
     * Verifies the connection by delegating to the provider's own `isReachable()`.
     * This ensures the correct endpoint paths and auth headers are used per-provider.
     */
    private async verifyConnection(provider: string, model: string, key: string): Promise<string> {
        try {
            const config = CLOUD_REGISTERY[provider];
            const adapterInstance = resolveAdapter(provider, config.baseUrl, key);
            const reachable = await adapterInstance.isReachable(model);

            if (reachable) {
                await this.glyphConfig.updateModel(model);
                await this.glyphConfig.updateEndpoint(config.baseUrl);
                await this.glyphConfig.updateProviderType(provider);
                await this.glyphConfig.addRegisteredModel(provider, model, config.baseUrl);

                this.statusBar.setModel(model);
                return `Glyph successfully connected to ${model}`;
            } else {
                return '';
            }
        } catch (error) {
            console.error(
                '[GlyphApp]: CloudProviderOrchestrator connection verification error',
                error,
            );
            return 'Unexpected error occurred, please check the logs';
        }
    }
}
