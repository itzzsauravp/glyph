import * as vscode from 'vscode';

export default class GlyphConfig {
    constructor(private readonly context: vscode.ExtensionContext) {}

    public getExtensionConfig = () => {
        const config = vscode.workspace.getConfiguration('glyph');
        const model = config.get<string>('modelName', '');
        const embeddingModel = config.get<string>('embeddingModelName', '');
        const endpoint = config.get<string>('base_url', '');
        const autoSave = config.get<boolean>('autoSave', false);
        const usingCloudOrchestrator = config.get<boolean>('usingCloudOrchestrator', false);
        const providerType = config.get<string>('providerType', 'Ollama');

        return { model, endpoint, autoSave, embeddingModel, usingCloudOrchestrator, providerType };
    };

    public async getApiKey(provider?: string): Promise<string | undefined> {
        const keyName = provider ? `glyph.apiKey.${provider.toLowerCase()}` : 'glyph.apiKey';
        let key = await this.context.secrets.get(keyName);
        if (!key && provider) {
            // fallback for backward compatibility
            key = await this.context.secrets.get('glyph.apiKey');
        }
        return key;
    }

    public async setApiKey(key: string, provider?: string): Promise<void> {
        const keyName = provider ? `glyph.apiKey.${provider.toLowerCase()}` : 'glyph.apiKey';
        await this.context.secrets.store(keyName, key);
    }

    public async removeApiKey(provider?: string): Promise<void> {
        const keyName = provider ? `glyph.apiKey.${provider.toLowerCase()}` : 'glyph.apiKey';
        await this.context.secrets.delete(keyName);
    }

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

    public updateEndpoint = async (newEndpoint: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('base_url', newEndpoint, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Endpoint updated to ${newEndpoint}`);
    };

    public updateProviderType = async (newProvider: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('providerType', newProvider, vscode.ConfigurationTarget.Global);
    };

    public getRegisteredModels(): Array<{ provider: string; model: string; endpoint: string }> {
        return this.context.globalState.get('glyph.registeredCloudModels') || [];
    }

    public async addRegisteredModel(
        provider: string,
        model: string,
        endpoint: string,
    ): Promise<void> {
        const models = this.getRegisteredModels();
        // Remove existing duplicate
        const filtered = models.filter((m) => !(m.provider === provider && m.model === model));
        filtered.push({ provider, model, endpoint });
        await this.context.globalState.update('glyph.registeredCloudModels', filtered);
    }

    public async removeRegisteredModel(provider: string, model: string): Promise<void> {
        const models = this.getRegisteredModels();
        const filtered = models.filter((m) => !(m.provider === provider && m.model === model));
        await this.context.globalState.update('glyph.registeredCloudModels', filtered);
    }

    public reloadConfig = () => {
        const config = this.getExtensionConfig();
        this.updateEmbeddingModel(config.embeddingModel);
        this.updateEndpoint(config.endpoint);
        this.updateModel(config.model);
    };
}
