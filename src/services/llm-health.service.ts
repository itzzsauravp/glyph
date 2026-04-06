import * as vscode from 'vscode';
import type GlyphConfig from '../config/glyph.config';
import { resolveProvider } from '../providers';

/**
 * Health-check service.
 *
 * Instead of hard-coding `/api/tags` (Ollama-only), it resolves the
 * active provider and delegates `isReachable()` and `getModels()` to it.
 */
export default class LLMHealth {
    constructor(private readonly glyphConfig: GlyphConfig) {}

    private async getActiveProvider() {
        const config = this.glyphConfig.getExtensionConfig();
        const apiKey = await this.glyphConfig.getApiKey(config.providerType);
        return resolveProvider(config.providerType, config.endpoint, apiKey);
    }

    public async preflight() {
        const provider = await this.getActiveProvider();

        const config = this.glyphConfig.getExtensionConfig();
        const isInstalled = await provider.isReachable(config.model);

        if (!isInstalled) {
            vscode.window.showErrorMessage(
                `${provider.displayName} is not reachable. Please make sure it is running or your API key is valid.`,
            );
            console.error(`[LLMHealth] ${provider.displayName} not reachable`);
            return false;
        }

        const models = await provider.getModels();
        if (!models.length) {
            vscode.window.showErrorMessage(
                'Glyph requires at least one model. Please install or configure a model.',
            );
            console.error('[LLMHealth] No models available');
            return false;
        }

        return true;
    }

    async isReachable(): Promise<boolean> {
        try {
            const provider = await this.getActiveProvider();
            const config = this.glyphConfig.getExtensionConfig();
            return await provider.isReachable(config.model);
        } catch {
            return false;
        }
    }

    async getModels(): Promise<string[]> {
        try {
            const provider = await this.getActiveProvider();
            return await provider.getModels();
        } catch {
            return [];
        }
    }

    async getModelsForPicker(): Promise<vscode.QuickPickItem[]> {
        try {
            const provider = await this.getActiveProvider();
            const items = await provider.getModelsForPicker();
            return items.map((item) => ({
                label: item.label,
                description: item.description,
                detail: item.detail,
                alwaysShow: true,
            }));
        } catch {
            return [];
        }
    }
}
