import * as vscode from "vscode";
import GlyphConfig from "../config/glyph.config";
import OllamaHealth from "../services/ollama-health.service";
import BaseCommand from "./base.command";

export default class ModelSelect extends BaseCommand {

    constructor(
        private readonly glyphConfig: GlyphConfig,
        private readonly ollamaHealth: OllamaHealth,
    ) {
        super();
    }

    public id: string = 'glyph.model_select';

    public action = async () => {

        const items = await this.ollamaHealth.getModelsForPicker();
        console.log(items);

        if (!items.length) {
            console.log(items);
            vscode.window.showErrorMessage("No models found. Install and run a model before picking one");
            return;
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select a model for Glyph"
        })

        if (!selected) {
            vscode.window.showErrorMessage("Error occured during model selection. Please check logs");
            return;
        }

        this.glyphConfig.updateModel(selected.label);

    };
}