// AI Services
export { default as LLMService } from './ai/llm.service';
export { default as LLMHealth } from './ai/llm-health.service';
export { default as RepositoryIndexerService } from './ai/repo-indexer.service';
export { default as VectorDatabaseService } from './ai/vector-database.service';

// Preflight
export type { IPreflightTester, PreflightResult } from './ai/preflight';
export { LocalPreflightTester, CloudPreflightTester } from './ai/preflight';

// Editor Services
export { default as EditorService } from './editor/editor.service';
export { default as EditorUIService } from './editor/editor-ui.service';
export { default as RangeTrackerService } from './editor/range-tracker.service';

// Core Services
export { default as CommandManagerService } from './core/command-manager.service';
export { default as StatusBarService, StatusState } from './core/status-bar.service';
export { default as ModelRegistryService } from './core/model-registry.service';
export type { UnifiedModelEntry } from './core/model-registry.service';
