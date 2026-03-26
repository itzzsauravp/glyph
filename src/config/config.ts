import * as vscode from 'vscode';

export class ConfigurationManager {


    public getExtensionConfig = () => {
        const config = vscode.workspace.getConfiguration('glyph');

        const model = config.get<string>('modelName', 'qwen2.5-coder:3b');
        const endpoint = config.get<string>('endpoint', 'http://localhost:11434');

        return { model, endpoint };
    }

    public updateModel = async (newModel: string) => {
        const config = vscode.workspace.getConfiguration('myExtension');

        // Use ConfigurationTarget.Global to save it for all projects
        // Use ConfigurationTarget.Workspace to save it only for this folder
        await config.update('modelName', newModel, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(`Model updated to ${newModel}`);
    }

    public updateEndpoint = async (newModel: string) => {
        const config = vscode.workspace.getConfiguration('myExtension');

        await config.update('modelName', newModel, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(`Model updated to ${newModel}`);
    }

}
