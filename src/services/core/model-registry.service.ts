import * as vscode from 'vscode';
import type GlyphConfig from '../../config/glyph.config';
import type ServerClient from '../server/server-client.service';
import { getProviderDisplayName } from '../../constants/provider.constants';
import { ProviderType } from '../../types/llm.types';

/**
 * Represents a single model entry in the unified model list.
 */
export interface UnifiedModelEntry {
    readonly name: string;
    readonly provider: string;
    readonly providerType: string;
    readonly endpoint: string;
    isCurrent: boolean;
    readonly source: 'live' | 'registered' | 'history';
}

/**
 * Default endpoints for local providers (probed directly from the extension).
 */
const LOCAL_PROVIDER_DEFAULTS = [
    {
        providerType: ProviderType.Ollama,
        displayName: 'Ollama',
        endpoint: 'http://127.0.0.1:11434',
        fetchUrl: (base: string) => `${base}/api/tags`,
        parseModels: (data: any): string[] =>
            Array.isArray(data?.models) ? data.models.map((m: any) => m.name) : [],
    },
    {
        providerType: ProviderType.LmStudio,
        displayName: 'LM Studio',
        endpoint: 'http://127.0.0.1:1234',
        fetchUrl: (base: string) => `${base}/v1/models`,
        parseModels: (data: any): string[] =>
            Array.isArray(data?.data) ? data.data.map((m: any) => m.id) : [],
    },
] as const;

const LOCAL_PROBE_TIMEOUT_MS = 2_000;

/**
 * Centralized service for aggregating models from all providers.
 *
 * v0.5.0: Uses ServerClient for cloud model fetching, keeps direct
 * local probe for Ollama/LM Studio (faster, no server dependency).
 */
export default class ModelRegistryService {
    private static readonly HISTORY_KEY = 'glyph.modelHistory';
    private static readonly MAX_HISTORY = 10;

    constructor(
        private readonly glyphConfig: GlyphConfig,
        private readonly serverClient: ServerClient,
    ) {}

    // ── Public API ──────────────────────────────────────────────────

    public async getUnifiedModelList(): Promise<UnifiedModelEntry[]> {
        const config = this.glyphConfig.getExtensionConfig();
        const currentModel = config.model;
        const entries: UnifiedModelEntry[] = [];
        const seen = new Set<string>();

        // 1. Live models from the active provider (via server)
        try {
            const apiKey = (await this.glyphConfig.getApiKey(config.providerType)) || '';
            const liveModels = await this.serverClient.getModels(
                config.providerType,
                config.endpoint,
                apiKey,
            );

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

        // 2. Discover models from local providers (direct probe — no server needed)
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

        const grouped = new Map<string, UnifiedModelEntry[]>();
        for (const entry of entries) {
            const group = grouped.get(entry.provider) || [];
            group.push(entry);
            grouped.set(entry.provider, group);
        }

        const items: vscode.QuickPickItem[] = [];

        for (const [provider, models] of grouped) {
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

    public async switchToModel(entry: UnifiedModelEntry): Promise<void> {
        await this.glyphConfig.updateModel(entry.name);
        await this.glyphConfig.updateEndpoint(entry.endpoint);
        await this.glyphConfig.updateProviderType(entry.providerType);
        await this.recordHistory(entry);
    }

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
                isCurrent: false,
                source: 'live' as const,
            }));
        } catch {
            return [];
        }
    }

    // ── History ─────────────────────────────────────────────────────

    private getHistory(): Array<Omit<UnifiedModelEntry, 'isCurrent' | 'source'>> {
        return this.glyphConfig.getGlobalState<
            Array<Omit<UnifiedModelEntry, 'isCurrent' | 'source'>>
        >(ModelRegistryService.HISTORY_KEY, []);
    }

    private async recordHistory(entry: UnifiedModelEntry): Promise<void> {
        const history = this.getHistory();
        const filtered = history.filter((h) => h.name !== entry.name);

        filtered.unshift({
            name: entry.name,
            provider: entry.provider,
            providerType: entry.providerType,
            endpoint: entry.endpoint,
        });

        const trimmed = filtered.slice(0, ModelRegistryService.MAX_HISTORY);
        await this.glyphConfig.updateGlobalState(ModelRegistryService.HISTORY_KEY, trimmed);
    }
}
