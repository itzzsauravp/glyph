import * as vscode from 'vscode';

export default class GlyphConfig {

    public getExtensionConfig = () => {

        const config = vscode.workspace.getConfiguration('glyph');
        const model = config.get<string>('modelName', '');
        const endpoint = config.get<string>('base_url', 'http://localhost:11434');
        const autoSave = config.get<boolean>('autoSave', false);

        return { model, endpoint, autoSave };

    }

    public updateModel = async (newModel: string) => {

        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('modelName', newModel, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model updated to ${newModel}`);

    }

    public toggleAutoSave = async () => {

        const config = vscode.workspace.getConfiguration('glyph');
        const autoSave = config.get<boolean>('autoSave', false);
        await config.update('autoSave', !autoSave, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Auto Save after generation has been turned ${autoSave ? "On" : "Off"}`);

    }

    public updateEndpoint = async (newEndpoint: string) => {

        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('base_url', newEndpoint, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Endpoint updated to ${newEndpoint}`);

    }

}
