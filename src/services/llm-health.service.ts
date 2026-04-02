import * as vscode from 'vscode';
import type GlyphConfig from '../config/glyph.config';

export default class LLMHealth {
    constructor(private readonly glyphConfig: GlyphConfig) { }

    private get baseUrl() {
        return this.glyphConfig.getExtensionConfig().endpoint;
    }

    public async preflight() {
        const isInstalled = await this.isReachable();
        if (!isInstalled) {
            vscode.window.showErrorMessage(
                'LLM service not reachable. Please make sure it is installed and running.',
            );
            console.error('Local LLM service not reachable');
            return false;
        }
        if (!(await this.getModels()).length) {
            vscode.window.showErrorMessage(
                'Glyph requires at least one model to be installed. Please install a recommended model for your spec',
            );
            console.error(
                'Glyph requires at least one model to be installed. Please install a recommended model for your spec',
            );
            return false;
        }
        return true;
    }

    async isReachable() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            return response.ok;
        } catch (_error) {
            console.error('Local LLM service not reachable');
            return false;
        }
    }

    async getModels(): Promise<Array<string>> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                return [];
            }

            const data = (await response.json()) as { models: { name: string }[] };
            return data.models.map((m) => m.name);
        } catch (_err) {
            return [];
        }
    }

    async getModelsForPicker(): Promise<vscode.QuickPickItem[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                return [];
            }

            const data = (await response.json()) as { models: { name: string }[] };

            return data.models.map((m: any) => ({
                label: m.name,
                description: `${m.details.parameter_size} | ${m.details.quantization_level}`,
                detail: `Size: ${(m.size / 1024 ** 3).toFixed(2)} GB`,
                alwaysShow: true,
            }));
        } catch (_err) {
            return [];
        }
    }
}
