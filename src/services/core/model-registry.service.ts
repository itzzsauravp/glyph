import * as vscode from 'vscode';
import { resolveAdapter } from '../../adapters';
import type GlyphConfig from '../../config/glyph.config';
import { getProviderDisplayName } from '../../constants/provider.constants';
import { ProviderType } from '../../types/llm.types';

/**
 * Represents a single model entry in the unified model list.
 * Every model — local, cloud, or custom — is normalized into this shape.
 */
export interface UnifiedModelEntry {
    /** Human-readable model name (e.g. "llama3.2", "gpt-4o"). */
    readonly name: string;
    /** Provider display name (e.g. "Ollama", "OpenRouter"). */
    readonly provider: string;
    /** Provider type key matching ProviderType enum / config string. */
    readonly providerType: string;
    /** API base URL for this provider. */
    readonly endpoint: string;
    /** Whether this model is currently the active one. */
    isCurrent: boolean;
    /** Source of this entry in the registry. */
    readonly source: 'live' | 'registered' | 'history';
}

/**
 * Default endpoints for local providers.
 * These are probed automatically regardless of which provider is active.
 */
const LOCAL_PROVIDER_DEFAULTS = [
    {
        providerType: ProviderType.Ollama,
        displayName: 'Ollama',
        endpoint: 'http://127.0.0.1:11434',
        /** Ollama native tag listing endpoint. */
        fetchUrl: (base: string) => `${base}/api/tags`,
        /** Parse the Ollama /api/tags response. */
        parseModels: (data: any): string[] =>
            Array.isArray(data?.models) ? data.models.map((m: any) => m.name) : [],
    },
    {
        providerType: ProviderType.LmStudio,
        displayName: 'LM Studio',
        endpoint: 'http://127.0.0.1:1234',
        /** LM Studio uses the OpenAI-compatible /v1/models endpoint. */
        fetchUrl: (base: string) => `${base}/v1/models`,
        /** Parse the OpenAI-compatible /v1/models response. */
        parseModels: (data: any): string[] =>
            Array.isArray(data?.data) ? data.data.map((m: any) => m.id) : [],
    },
] as const;

/** Timeout (ms) for local provider probes so they don't block the UI. */
const LOCAL_PROBE_TIMEOUT_MS = 2_000;

/**
 * Centralized service for aggregating models from all providers into a
 * single unified list. Serves as the **single source of truth** for any
 * UI or command that needs to display or switch models.
 *
 * Sources:
 *  1. **Live models** — fetched from the active provider's API (e.g. Ollama /api/tags).
 *  2. **Discovered local models** — probed from all known local endpoints (Ollama, LM Studio).
 *  3. **Registered models** — cloud models the user explicitly set up via the orchestrator.
 *  4. **Model history** — models the user has previously used (persisted in globalState).
 */
export default class ModelRegistryService {
    private static readonly HISTORY_KEY = 'glyph.modelHistory';
    private static readonly MAX_HISTORY = 10;

    constructor(private readonly glyphConfig: GlyphConfig) {
        // No auto-recorder here anymore — we'll trigger explicitly from switchToModel
        // ensuring we have the full entry with correct provider metadata.
    }

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Returns a deduplicated, sorted list of all available models from
     * every source (live provider, local discovery, registered cloud models, history).
     *
     * The list is grouped by source priority: live → local → registered → history.
     * Each entry is marked with `isCurrent` if it matches the active model.
     */
    public async getUnifiedModelList(): Promise<UnifiedModelEntry[]> {
        const config = this.glyphConfig.getExtensionConfig();
        const currentModel = config.model;
        const entries: UnifiedModelEntry[] = [];
        const seen = new Set<string>();

        // 1. Live models from the active provider
        try {
            const apiKey = await this.glyphConfig.getApiKey(config.providerType);
            const adapter = resolveAdapter(config.providerType, config.endpoint, apiKey);
            const liveModels = await adapter.getModels();

            for (const name of liveModels) {
                const key = `${config.providerType}::${name}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    entries.push({
                        name,
                        provider: getProviderDisplayName(config.providerType),
                        providerType: config.providerType,
                        endpoint: config.endpoint,
                        isCurrent: name === currentModel,
                        source: 'live',
                    });
                }
            }
        } catch (err) {
            console.warn('[ModelRegistry] Failed to fetch live models:', err);
        }

        // 2. Discover models from ALL known local providers
        const localModels = await this.discoverLocalModels();
        for (const entry of localModels) {
            const key = `${entry.providerType}::${entry.name}`;
            if (!seen.has(key)) {
                seen.add(key);
                entries.push({
                    ...entry,
                    provider: getProviderDisplayName(entry.providerType),
                    isCurrent: entry.name === currentModel,
                });
            }
        }

        // 3. Registered cloud models
        const registered = this.glyphConfig.getRegisteredModels();
        for (const reg of registered) {
            const key = `${reg.provider}::${reg.model}`;
            if (!seen.has(key)) {
                seen.add(key);
                entries.push({
                    name: reg.model,
                    provider: getProviderDisplayName(reg.provider),
                    providerType: reg.provider,
                    endpoint: reg.endpoint,
                    isCurrent: reg.model === currentModel,
                    source: 'registered',
                });
            }
        }

        // 4. Model history
        const history = this.getHistory();
        for (const h of history) {
            const key = `${h.providerType}::${h.name}`;
            if (!seen.has(key)) {
                seen.add(key);
                entries.push({
                    ...h,
                    provider: getProviderDisplayName(h.providerType),
                    isCurrent: h.name === currentModel,
                    source: 'history',
                });
            }
        }

        return entries;
    }

    /**
     * Converts the unified model list into VS Code QuickPickItems,
     * grouped by provider with separators.
     */
    public async getModelsForPicker(): Promise<vscode.QuickPickItem[]> {
        const entries = await this.getUnifiedModelList();
        if (entries.length === 0) {
            return [
                {
                    label: '$(warning) No models available',
                    description: 'Configure a provider first',
                },
            ];
        }

        // Group entries by provider display name.
        const grouped = new Map<string, UnifiedModelEntry[]>();
        for (const entry of entries) {
            const group = grouped.get(entry.provider) || [];
            group.push(entry);
            grouped.set(entry.provider, group);
        }

        const items: vscode.QuickPickItem[] = [];

        for (const [provider, models] of grouped) {
            // Provider separator header
            items.push({
                label: provider,
                kind: vscode.QuickPickItemKind.Separator,
            });

            for (const entry of models) {
                const activePrefix = entry.isCurrent ? '$(check) ' : '';
                items.push({
                    label: `${activePrefix}${entry.name}`,
                    description: entry.providerType,
                    alwaysShow: entry.isCurrent,
                });
            }
        }

        return items;
    }

    /**
     * Switches the active model, endpoint, and provider type in one atomic step.
     * Fires config change events that propagate to subscribers (StatusBar, Brainstorm, etc.).
     */
    public async switchToModel(entry: UnifiedModelEntry): Promise<void> {
        await this.glyphConfig.updateModel(entry.name);
        await this.glyphConfig.updateEndpoint(entry.endpoint);
        await this.glyphConfig.updateProviderType(entry.providerType);
        // Explicitly record history with the correct entry metadata.
        await this.recordHistory(entry);
    }

    /**
     * Finds the `UnifiedModelEntry` matching a QuickPickItem label.
     * Optionally accepts providerType for precise matching when
     * the same model name exists under multiple providers.
     */
    public async resolvePickerSelection(
        label: string,
        providerType?: string,
    ): Promise<UnifiedModelEntry | undefined> {
        const cleanLabel = label.replace(/^\$\(history\)\s*/, '');
        const entries = await this.getUnifiedModelList();

        if (providerType) {
            return entries.find((e) => e.name === cleanLabel && e.providerType === providerType);
        }
        return entries.find((e) => e.name === cleanLabel);
    }

    // ── Local Provider Discovery ────────────────────────────────────

    /**
     * Probes all known local provider endpoints in parallel and returns
     * any models they expose. Each probe has a short timeout so the UI
     * is never blocked by an offline service.
     */
    private async discoverLocalModels(): Promise<UnifiedModelEntry[]> {
        const results = await Promise.allSettled(
            LOCAL_PROVIDER_DEFAULTS.map((provider) => this.probeLocalProvider(provider)),
        );

        const entries: UnifiedModelEntry[] = [];
        for (const result of results) {
            if (result.status === 'fulfilled') {
                entries.push(...result.value);
            }
        }
        return entries;
    }

    /**
     * Fetches the model list from a single local provider.
     * Returns an empty array if the provider is not reachable.
     */
    private async probeLocalProvider(
        provider: (typeof LOCAL_PROVIDER_DEFAULTS)[number],
    ): Promise<UnifiedModelEntry[]> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);

            const url = provider.fetchUrl(provider.endpoint);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!res.ok) {
                return [];
            }

            const data = await res.json();
            const modelNames = provider.parseModels(data);

            return modelNames.map((name) => ({
                name,
                provider: provider.displayName,
                providerType: provider.providerType,
                endpoint: provider.endpoint,
                isCurrent: false, // caller sets this
                source: 'live' as const,
            }));
        } catch {
            // Provider not running or unreachable — silently skip.
            return [];
        }
    }

    // ── History ─────────────────────────────────────────────────────

    /**
     * Returns the most recently used models from globalState.
     */
    private getHistory(): Array<Omit<UnifiedModelEntry, 'isCurrent' | 'source'>> {
        return this.glyphConfig.getGlobalState<
            Array<Omit<UnifiedModelEntry, 'isCurrent' | 'source'>>
        >(ModelRegistryService.HISTORY_KEY, []);
    }

    /**
     * Records a model usage in the MRU history (max 10 entries, deduplicated).
     */
    private async recordHistory(entry: UnifiedModelEntry): Promise<void> {
        const history = this.getHistory();

        // Remove duplicate if already present.
        const filtered = history.filter((h) => h.name !== entry.name);

        // Prepend new entry with explicit provider info from the entry itself.
        filtered.unshift({
            name: entry.name,
            provider: entry.provider,
            providerType: entry.providerType,
            endpoint: entry.endpoint,
        });

        // Trim to max history size.
        const trimmed = filtered.slice(0, ModelRegistryService.MAX_HISTORY);

        await this.glyphConfig.updateGlobalState(ModelRegistryService.HISTORY_KEY, trimmed);
    }
}
