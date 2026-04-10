import * as vscode from 'vscode';

/**
 * Payload emitted when any Glyph configuration value changes.
 */
export interface GlyphConfigChangeEvent {
    /** The specific setting key that changed (e.g. 'model', 'providerType'). */
    readonly key: string;
    /** The new value of the setting. */
    readonly value: string | boolean;
}

/**
 * Central configuration manager for the Glyph extension.
 *
 * Reads VS Code settings, manages API keys via SecretStorage,
 * and maintains a registry of cloud models. Emits an event whenever
 * a configuration value is programmatically updated so that services
 * and UI components can react without polling.
 */
export default class GlyphConfig {
    private readonly _onDidChange = new vscode.EventEmitter<GlyphConfigChangeEvent>();

    /**
     * Fired whenever a Glyph configuration value is programmatically updated.
     * Subscribe to this to keep UI or other services in sync.
     */
    public readonly onDidChange: vscode.Event<GlyphConfigChangeEvent> = this._onDidChange.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        // Dispose the emitter when the extension is deactivated.
        context.subscriptions.push(this._onDidChange);
    }

    /**
     * Returns the current snapshot of all Glyph extension settings.
     */
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

    // ── API Key Management ──────────────────────────────────────────

    /**
     * Retrieves the stored API key for the given provider.
     * Falls back to the generic `glyph.apiKey` for backward compatibility.
     */
    public async getApiKey(provider?: string): Promise<string | undefined> {
        const keyName = provider ? `glyph.apiKey.${provider.toLowerCase()}` : 'glyph.apiKey';
        let key = await this.context.secrets.get(keyName);
        if (!key && provider) {
            key = await this.context.secrets.get('glyph.apiKey');
        }
        return key;
    }

    /**
     * Stores an API key securely for the given provider.
     */
    public async setApiKey(key: string, provider?: string): Promise<void> {
        const keyName = provider ? `glyph.apiKey.${provider.toLowerCase()}` : 'glyph.apiKey';
        await this.context.secrets.store(keyName, key);
    }

    /**
     * Removes the stored API key for the given provider.
     */
    public async removeApiKey(provider?: string): Promise<void> {
        const keyName = provider ? `glyph.apiKey.${provider.toLowerCase()}` : 'glyph.apiKey';
        await this.context.secrets.delete(keyName);
    }

    // ── Setting Updaters (fire events) ──────────────────────────────

    /**
     * Updates the active language model and fires a change event.
     */
    public updateModel = async (newModel: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('modelName', newModel, vscode.ConfigurationTarget.Global);
        this._onDidChange.fire({ key: 'model', value: newModel });
    };

    /**
     * Updates the active embedding model and fires a change event.
     */
    public updateEmbeddingModel = async (newEmbeddingModel: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update(
            'embeddingModelName',
            newEmbeddingModel,
            vscode.ConfigurationTarget.Global,
        );
        this._onDidChange.fire({ key: 'embeddingModel', value: newEmbeddingModel });
    };

    /**
     * Toggles the autoSave setting and fires a change event.
     */
    public toggleAutoSave = async () => {
        const config = vscode.workspace.getConfiguration('glyph');
        const autoSave = config.get<boolean>('autoSave', false);
        await config.update('autoSave', !autoSave, vscode.ConfigurationTarget.Global);
        this._onDidChange.fire({ key: 'autoSave', value: !autoSave });
    };

    /**
     * Updates the base API endpoint and fires a change event.
     */
    public updateEndpoint = async (newEndpoint: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('base_url', newEndpoint, vscode.ConfigurationTarget.Global);
        this._onDidChange.fire({ key: 'endpoint', value: newEndpoint });
    };

    /**
     * Updates the active provider type and fires a change event.
     */
    public updateProviderType = async (newProvider: string) => {
        const config = vscode.workspace.getConfiguration('glyph');
        await config.update('providerType', newProvider, vscode.ConfigurationTarget.Global);
        this._onDidChange.fire({ key: 'providerType', value: newProvider });
    };

    // ── Registered Cloud Models ─────────────────────────────────────

    /**
     * Returns all cloud models the user has previously registered.
     */
    public getRegisteredModels(): Array<{ provider: string; model: string; endpoint: string }> {
        return this.context.globalState.get('glyph.registeredCloudModels') || [];
    }

    /**
     * Adds a cloud model to the persistent registry (de-duplicates by provider+model).
     */
    public async addRegisteredModel(
        provider: string,
        model: string,
        endpoint: string,
    ): Promise<void> {
        const models = this.getRegisteredModels();
        const filtered = models.filter((m) => !(m.provider === provider && m.model === model));
        filtered.push({ provider, model, endpoint });
        await this.context.globalState.update('glyph.registeredCloudModels', filtered);
    }

    /**
     * Removes a cloud model from the persistent registry.
     */
    public async removeRegisteredModel(provider: string, model: string): Promise<void> {
        const models = this.getRegisteredModels();
        const filtered = models.filter((m) => !(m.provider === provider && m.model === model));
        await this.context.globalState.update('glyph.registeredCloudModels', filtered);
    }

    // ── Global State Access ──────────────────────────────────────────

    /**
     * Reads a value from the extension's persistent global state.
     */
    public getGlobalState<T>(key: string, defaultValue: T): T {
        return this.context.globalState.get<T>(key, defaultValue);
    }

    /**
     * Writes a value to the extension's persistent global state.
     */
    public async updateGlobalState<T>(key: string, value: T): Promise<void> {
        await this.context.globalState.update(key, value);
    }

    /**
     * Reloads the config by re-reading VS Code settings and emitting change events.
     */
    public reloadConfig = () => {
        const config = this.getExtensionConfig();
        this._onDidChange.fire({ key: 'model', value: config.model });
        this._onDidChange.fire({ key: 'endpoint', value: config.endpoint });
        this._onDidChange.fire({ key: 'providerType', value: config.providerType });
    };
}
