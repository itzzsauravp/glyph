import * as vscode from "vscode";

export default class OllamaHealth {

    constructor() { }

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
            const response = await fetch("http://127.0.0.1:11434/api/tags");
            return response.ok;
        } catch (error) {
            console.error("Ollama service not reachable");
            return false;
        }
    }

    async getOllamaModels(): Promise<Array<string>> {
        try {
            const response = await fetch("http://127.0.0.1:11434/api/tags");
            if (!response.ok) return [];

            const data = await response.json() as { models: { name: string }[] };
            return data.models.map(m => m.name);
        } catch (err) {
            return [];
        }
    }


}