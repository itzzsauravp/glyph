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
                const result = await this.verifyConnection(
                    selectedProvider,
                    selectedModel,
                    apiKey,
                );

                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                } else {
                    vscode.window.showErrorMessage(`Glyph: ${result.message}`);
                    // Only delete the key on explicit auth failures
                    if (result.isAuthError) {
                        await this.context.secrets.delete(secretKey);
                    }
                }
            },
        );
    };

    /**
     * Verifies the connection by delegating to the provider's own `isReachable()`.
     * Returns a structured result so the caller can show actionable messages.
     */
    private async verifyConnection(
        provider: string,
        model: string,
        key: string,
    ): Promise<{ success: boolean; message: string; isAuthError?: boolean }> {
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
                return { success: true, message: `Successfully connected to ${model}` };
            }

            return {
                success: false,
                message: `Could not verify connection to ${provider}. The endpoint may be temporarily unavailable.`,
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const isAuthError = msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized');

            console.error('[CloudProviderOrchestrator]', msg);

            return {
                success: false,
                message: `${provider} connection failed: ${msg}`,
                isAuthError,
            };
        }
    }
}

