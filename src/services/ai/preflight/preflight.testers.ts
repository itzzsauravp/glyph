import type { BaseLLMAdapter } from '../../../adapters';
import type { IPreflightTester, PreflightResult } from './preflight.types';

/**
 * Preflight tester for local providers (Ollama, LM Studio).
 *
 * Checks:
 *  1. Endpoint connectivity
 *  2. At least one model available
 *  3. Embedding model available (nomic-embed-text for Ollama)
 */
export class LocalPreflightTester implements IPreflightTester {
    readonly providerName: string;

    constructor(providerName: string = 'Local') {
        this.providerName = providerName;
    }

    async run(
        adapter: BaseLLMAdapter,
        _apiKey: string | undefined,
        model: string,
    ): Promise<PreflightResult[]> {
        const results: PreflightResult[] = [];

        // Check 1: Endpoint reachable
        const reachable = await adapter.isReachable(model);
        results.push({
            check: 'Endpoint Reachable',
            passed: reachable,
            detail: reachable ? undefined : `Cannot reach ${this.providerName}. Is it running?`,
        });

        if (!reachable) {
            return results;
        }

        // Check 2: Models available
        const models = await adapter.getModels();
        results.push({
            check: 'Models Available',
            passed: models.length > 0,
            detail: models.length > 0 ? `${models.length} model(s) found` : 'No models installed.',
        });

        // Check 3: Embedding model (Ollama-specific)
        if (this.providerName === 'Ollama') {
            const hasEmbedding = models.some((m) => m.includes('nomic-embed-text'));
            results.push({
                check: 'Embedding Model (nomic-embed-text)',
                passed: hasEmbedding,
                detail: hasEmbedding
                    ? undefined
                    : 'Run "ollama pull nomic-embed-text" for codebase indexing.',
            });
        }

        return results;
    }
}

/**
 * Preflight tester for cloud providers (OpenAI, OpenRouter, Anthropic, Gemini, Groq).
 *
 * Checks:
 *  1. API key present
 *  2. Endpoint reachable / authentication valid
 *  3. Configured model accessible
 */
export class CloudPreflightTester implements IPreflightTester {
    readonly providerName: string;

    constructor(providerName: string) {
        this.providerName = providerName;
    }

    async run(
        adapter: BaseLLMAdapter,
        apiKey: string | undefined,
        model: string,
    ): Promise<PreflightResult[]> {
        const results: PreflightResult[] = [];

        // Check 1: API Key present
        const hasKey = !!apiKey && apiKey.length > 0;
        results.push({
            check: 'API Key Present',
            passed: hasKey,
            detail: hasKey
                ? undefined
                : `No API key found for ${this.providerName}. Use the Cloud Provider Orchestrator to set one.`,
        });

        if (!hasKey) {
            return results;
        }

        // Check 2: Endpoint reachable (also validates auth)
        let reachable = false;
        let reachabilityDetail: string | undefined;
        try {
            reachable = await adapter.isReachable(model);
            if (!reachable) {
                reachabilityDetail = `Cannot reach ${this.providerName}. The API key may be invalid, or the endpoint is unreachable.`;
            }
        } catch (err) {
            reachabilityDetail = `${this.providerName} connectivity check failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        results.push({
            check: 'Endpoint & Auth Valid',
            passed: reachable,
            detail: reachable ? undefined : reachabilityDetail,
        });

        // Check 3: Model accessible
        if (reachable && model) {
            // For providers with static model lists, just verify the model is in the list.
            const models = await adapter.getModels();
            const modelExists = models.length === 0 || models.some((m) => m === model);
            results.push({
                check: `Model "${model}" Accessible`,
                passed: modelExists,
                detail: modelExists
                    ? undefined
                    : `Model "${model}" not found on ${this.providerName}. Available: ${models.slice(0, 5).join(', ')}`,
            });
        }

        return results;
    }
}
