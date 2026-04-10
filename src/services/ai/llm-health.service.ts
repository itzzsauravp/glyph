import * as vscode from 'vscode';
import { resolveAdapter } from '../../adapters';
import type GlyphConfig from '../../config/glyph.config';
import { ProviderType } from '../../types/llm.types';
import { CloudPreflightTester, LocalPreflightTester } from './preflight/preflight.testers';
import type { IPreflightTester, PreflightResult } from './preflight/preflight.types';

/**
 * Health-check and diagnostics service.
 *
 * Delegates provider-specific checks to {@link IPreflightTester} implementations.
 * Exposes both a quick startup preflight and a full diagnostic command.
 */
export default class LLMHealth {
    constructor(private readonly glyphConfig: GlyphConfig) {}

    // ── Adapter Resolution ──────────────────────────────────────────

    /**
     * Resolves the adapter for the currently active provider configuration.
     */
    private async getActiveAdapter() {
        const config = this.glyphConfig.getExtensionConfig();
        const apiKey = await this.glyphConfig.getApiKey(config.providerType);
        return resolveAdapter(config.providerType, config.endpoint, apiKey);
    }

    // ── Tester Resolution ───────────────────────────────────────────

    /**
     * Returns the appropriate preflight tester for the given provider type string.
     */
    private getTesterForProvider(providerType: string): IPreflightTester {
        switch (providerType) {
            case ProviderType.Ollama:
                return new LocalPreflightTester('Ollama');
            case ProviderType.LmStudio:
                return new LocalPreflightTester('LM Studio');
            case ProviderType.OpenAI:
                return new CloudPreflightTester('OpenAI');
            case ProviderType.OpenRouter:
                return new CloudPreflightTester('OpenRouter');
            case ProviderType.Anthropic:
                return new CloudPreflightTester('Anthropic');
            case ProviderType.Google:
                return new CloudPreflightTester('Gemini');
            default:
                return new CloudPreflightTester(providerType);
        }
    }

    // ── Quick Preflight (startup) ───────────────────────────────────

    /**
     * Runs a quick preflight check for the active provider.
     * Returns `true` if all essential checks pass, `false` otherwise.
     * Displays error/warning messages to the user on failure.
     */
    public async preflight(): Promise<boolean> {
        const config = this.glyphConfig.getExtensionConfig();
        const apiKey = await this.glyphConfig.getApiKey(config.providerType);
        const adapter = await this.getActiveAdapter();
        const tester = this.getTesterForProvider(config.providerType);

        const results = await tester.run(adapter, apiKey, config.model);

        console.log('Result from preflight:', results);

        let allPassed = true;
        for (const result of results) {
            if (!result.passed) {
                allPassed = false;
                console.error('[LLMHealth]', `[${result.check}] FAILED: ${result.detail}`);

                if (result.check === 'Embedding Model (nomic-embed-text)') {
                    // Warning, not blocking
                    vscode.window
                        .showWarningMessage(`Glyph: ${result.detail}`, 'Show Log Viewer')
                        .then((action) => {
                            if (action === 'Show Log Viewer') {
                                vscode.commands.executeCommand('glyph.show_logs');
                            }
                        });
                    allPassed = true; // embedding model is non-blocking
                } else {
                    vscode.window.showErrorMessage(`Glyph Preflight: ${result.detail}`);
                }
            } else {
                console.log('[LLMHealth]', `[${result.check}] PASSED`);
            }
        }

        if (allPassed) {
            console.log('[LLMHealth]', `Preflight successful for ${adapter.displayName}.`);
        }

        return allPassed;
    }

    // ── Full Diagnostic ─────────────────────────────────────────────

    /**
     * Runs a comprehensive diagnostic across all registered providers.
     * Returns a structured report of all results for display.
     */
    public async runFullDiagnostic(): Promise<Map<string, PreflightResult[]>> {
        const report = new Map<string, PreflightResult[]>();
        const config = this.glyphConfig.getExtensionConfig();

        // 1. Active provider
        const apiKey = await this.glyphConfig.getApiKey(config.providerType);
        const adapter = await this.getActiveAdapter();
        const tester = this.getTesterForProvider(config.providerType);
        const activeResults = await tester.run(adapter, apiKey, config.model);
        report.set(`${config.providerType} (Active)`, activeResults);

        // 2. All registered cloud models (test each unique provider)
        const registered = this.glyphConfig.getRegisteredModels();
        const testedProviders = new Set<string>([config.providerType]);

        for (const reg of registered) {
            if (testedProviders.has(reg.provider)) {
                continue;
            }
            testedProviders.add(reg.provider);

            try {
                const regKey = await this.glyphConfig.getApiKey(reg.provider);
                const regAdapter = resolveAdapter(reg.provider, reg.endpoint, regKey);
                const regTester = this.getTesterForProvider(reg.provider);
                const regResults = await regTester.run(regAdapter, regKey, reg.model);
                report.set(reg.provider, regResults);
            } catch (err) {
                report.set(reg.provider, [
                    {
                        check: 'Provider Setup',
                        passed: false,
                        detail: `Failed to initialize: ${err}`,
                    },
                ]);
            }
        }

        return report;
    }

    // ── Simple Helpers (backward compat) ────────────────────────────

    /**
     * Returns `true` when the active provider is reachable.
     */
    async isReachable(): Promise<boolean> {
        try {
            const adapter = await this.getActiveAdapter();
            const config = this.glyphConfig.getExtensionConfig();
            return await adapter.isReachable(config.model);
        } catch {
            return false;
        }
    }

    /**
     * Returns model names from the active provider.
     */
    async getModels(): Promise<string[]> {
        try {
            const adapter = await this.getActiveAdapter();
            return await adapter.getModels();
        } catch {
            return [];
        }
    }

    /**
     * Returns QuickPickItems for the active provider's models.
     * @deprecated Use `ModelRegistryService.getModelsForPicker()` instead.
     */
    async getModelsForPicker(): Promise<vscode.QuickPickItem[]> {
        try {
            const adapter = await this.getActiveAdapter();
            const items = await adapter.getModelsForPicker();
            return items.map((item) => ({
                label: item.label,
                description: item.description,
                detail: item.detail,
                alwaysShow: true,
            }));
        } catch {
            return [];
        }
    }
}
