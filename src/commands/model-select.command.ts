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
        const { model: currentModel } = this.glyphConfig.getExtensionConfig();

        const itemsWithSelection = items.map(item => {
            const isActive = item.label === currentModel;
            return {
                ...item,
                description: isActive ? `$(check) ACTIVE | ${item.description}` : item.description,
                detail: isActive ? "Current selection" : item.detail
            };
        });

        const selected = await vscode.window.showQuickPick(itemsWithSelection, {
            placeHolder: "Select a model for Glyph",
        });

        if (!selected) {
            return;
        }

        await this.glyphConfig.updateModel(selected.label);

        console.log(items, itemsWithSelection);
    };
}