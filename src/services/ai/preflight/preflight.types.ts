import { BaseLLMAdapter } from "../../../adapters";

/**
 * Result of a single preflight test step.
 */
export interface PreflightResult {
    /** Human-readable name of the check (e.g. "API Key Present"). */
    readonly check: string;
    /** Whether the check passed. */
    readonly passed: boolean;
    /** Optional detail message (shown on failure). */
    readonly detail?: string;
}

/**
 * Contract for provider-specific preflight testers.
 *
 * Each cloud (or local) provider implements this interface to perform
 * its own set of sanity checks (key presence, endpoint reachability,
 * model availability, auth validity).
 */
export interface IPreflightTester {
    /** Human-readable provider name. */
    readonly providerName: string;

    /**
     * Runs all preflight checks for this provider and returns the results.
     *
     * @param adapter  - The resolved adapter instance for this provider.
     * @param apiKey   - The API key (may be undefined for local providers).
     * @param model    - The currently configured model name.
     */
    run(adapter: BaseLLMAdapter, apiKey: string | undefined, model: string): Promise<PreflightResult[]>;
}
