import * as vscode from "vscode";
import { exec } from "node:child_process"
import { promisify } from "node:util"

const execPromise = promisify(exec);

export default class OllamaHealth {

    constructor() { }

    public async preflight() {
        const ollamaInstalled = this.isInstalled();
        if (!ollamaInstalled) {
            // may be give user a way to install ollama form here itself
            vscode.window.showErrorMessage("Ollama not installed");
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

    async isInstalled() {
        try {
            await execPromise("ollama --version");
            return true;
        } catch (error) {
            console.error("ollama not installed");
            return false;
        }
    }

    async getOllamaModels(): Promise<Array<string>> {
        try {
            const { stdout } = await execPromise("ollama list");

            const models = stdout
                .split("\n")
                .slice(1)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                    return line.split(/\s+/)[0];
                });

            return models;
        } catch (err) {
            console.error("Error fetching models:", err);
            return [];
        }
    }


}