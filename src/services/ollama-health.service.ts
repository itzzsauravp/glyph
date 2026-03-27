import * as vscode from "vscode";

export default class OllamaHealth {

    constructor() { }

    public async preflight() {
        const ollamaInstalled = this.isReachable();
        if (!ollamaInstalled) {
            vscode.window.showErrorMessage("Ollama servicee not reachable. Please make sure installed and running");
            console.error("Ollama not installed")
            return false;
        }
        if (!(await this.getOllamaModels()).length) {
            vscode.window.showErrorMessage("Glpyh requires atleast one model to be install, Please install a recommended model for you spec");
            console.error("Glpyh requires atleast one model to be install, Please install a recommended model for you spec")
            return false;
        }
        return true;
    }

    async isReachable() {
        try {
            const response = await fetch("http://127.0.0.1:11434/api/tags");
            console.log(response);
            return response.ok;
        } catch (error) {
            console.error("Ollama service not reachable");
            return false;
        }
    }

    async getOllamaModels(): Promise<Array<string>> {
        try {
            const response = await fetch("http://127.0.0.1:11434/api/tags");
            console.log(response);
            if (!response.ok) return [];

            const data = await response.json() as { models: { name: string }[] };
            console.log(data.models.map((m) => m.name))
            return data.models.map(m => m.name);
        } catch (err) {
            return [];
        }
    }


}