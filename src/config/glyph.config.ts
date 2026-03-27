import * as vscode from 'vscode';

export default class GlyphConfig {

    public getExtensionConfig = () => {

        const config = vscode.workspace.getConfiguration('glyph');
        const model = config.get<string>('modelName', '');
        const endpoint = config.get<string>('endpoint', 'http://localhost:11434');

        return { model, endpoint };

    }

    public updateModel = async (newModel: string) => {

        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('modelName', newModel, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model updated to ${newModel}`);

    }

    public updateEndpoint = async (newEndpoint: string) => {

        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('endpoint', newEndpoint, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Endpoint updated to ${newEndpoint}`);

    }

}
