import * as vscode from 'vscode';
import type GlyphConfig from '../config/glyph.config';
import { CLOUD_REGISTERY } from '../constants';
import type StatusBarService from '../services/status-bar.service';
import type { ICloudRegistery } from '../types/llm.types';
import BaseCommand from './base.command';

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

        // TODO: have to add commands to let the user remove and manage their API keys
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

    private async verifyConnection(provider: string, model: string, key: string): Promise<string> {
        const config = CLOUD_REGISTERY[provider];

        try {
            const response = await fetch(config.baseUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1,
                }),
            });
            if (response.status === 200) {
                await this.glyphConfig.updateModel(model);
                await this.glyphConfig.updateEndpoint(config.baseUrl);
                this.statusBar.setModel(model);
                return `Glyph successfully connected to ${model}`;
            } else if (response.status === 429) {
                this.statusBar.setHealthy(false);
                return `${model} has hit the rate limit`;
            } else {
                return ``;
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
