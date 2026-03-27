import * as vscode from "vscode";
import GlyphConfig from "../config/glyph.config";

export default class OllamaHealth {

    constructor(
        private readonly glyphConfig: GlyphConfig
    ) { }

    private get baseUrl() {
        return this.glyphConfig.getExtensionConfig().endpoint;
    }

    public async preflight() {
        const ollamaInstalled = this.isReachable();
        if (!ollamaInstalled) {
            vscode.window.showErrorMessage("Ollama service not reachable. Please make sure installed and running");
            console.error("Ollama not installed");
            return false;
        }
        if (!(await this.getOllamaModels()).length) {
            vscode.window.showErrorMessage("Glyph requires at least one model to be installed. Please install a recommended model for your spec");
            console.error("Glyph requires at least one model to be installed. Please install a recommended model for your spec");
            return false;
        }
        return true;
    }

    async isReachable() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            return response.ok;
        } catch (error) {
            console.error("Ollama service not reachable");
            return false;
        }
    }

    async getOllamaModels(): Promise<Array<string>> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) return [];

            const data = await response.json() as { models: { name: string }[] };
            return data.models.map(m => m.name);
        } catch (err) {
            return [];
        }
    }

    async getModelsForPicker(): Promise<vscode.QuickPickItem[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) return [];

            const data = await response.json() as { models: { name: string }[] };

            return data.models.map((m: any) => ({
                label: m.name,
                description: `${m.details.parameter_size} | ${m.details.quantization_level}`,
                detail: `Size: ${(m.size / (1024 ** 3)).toFixed(2)} GB`,
                alwaysShow: true
            }));
        } catch (err) {
            return [];
        }
    }

}