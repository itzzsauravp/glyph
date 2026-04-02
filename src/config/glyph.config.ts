import * as vscode from 'vscode';

export default class GlyphConfig {
    public getExtensionConfig = () => {
        const config = vscode.workspace.getConfiguration('glyph');
        const model = config.get<string>('modelName', '');
        const embeddingModel = config.get<string>('embeddingModelName', '');
        const endpoint = config.get<string>('base_url', 'http://localhost:11434');
        const autoSave = config.get<boolean>('autoSave', false);
        const usingCloudOrchestrator = config.get<boolean>('usingCloudOrchestrator', false);

        return { model, endpoint, autoSave, embeddingModel, usingCloudOrchestrator };
    };

    public updateModel = async (newModel: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('modelName', newModel, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model updated to ${newModel}`);
    };

    public updateEmbeddingModel = async (newEmbeddingModel: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update(
            'embeddingModelName',
            newEmbeddingModel,
            vscode.ConfigurationTarget.Global,
        );
        vscode.window.showInformationMessage(`Embedding Model updated to ${newEmbeddingModel}`);
    };

    public toggleAutoSave = async () => {
        const config = vscode.workspace.getConfiguration('glyph');
        const autoSave = config.get<boolean>('autoSave', false);
        await config.update('autoSave', !autoSave, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
            `Auto Save after generation has been turned ${autoSave ? 'On' : 'Off'}`,
        );
    };

    public toggleUsingCloudOrchestrator = async () => {
        const config = vscode.workspace.getConfiguration('glyph');
        const usingCloudOrchestrator = config.get<boolean>('usingCloudOrchestrator', false);
        await config.update('usingCloudOrchestrator', !usingCloudOrchestrator, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
            `Use of cloud AI model has been turned ${usingCloudOrchestrator ? 'On' : 'Off'}`,
        );

    }

    public updateEndpoint = async (newEndpoint: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('base_url', newEndpoint, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Endpoint updated to ${newEndpoint}`);
    };
}
