import * as vscode from 'vscode';
import { CloudProviderOrchestrator } from '../commands/cloud-provider-orchestrator';
import GenerateCode from '../commands/generate-code.command';
import GenerateDocs from '../commands/generate-docs.command';
import ModelSelect from '../commands/model-select.command';
import TestCommand from '../commands/test.command';
import GlyphConfig from '../config/glyph.config';
import CommandManager from '../services/command-manager.service';
import EditorService from '../services/editor.service';
import EditorUIService from '../services/editor-ui.service';
import LLMService from '../services/llm.service';
import LLMHealth from '../services/llm-health.service';
import RangeTrackerService from '../services/range-tracker.service';
import RepositoryIndexerService from '../services/repo-indexer.service';
import StatusBarService from '../services/status-bar.service';
import VectorDatabaseService from '../services/vector-database.service';

/**
 * Root application class — owns every service and command.
 *
 * Initialization follows a strict sequential order so that every
 * dependency is fully resolved before it is handed to its consumers.
 *
 *   Config → Health → VectorDB → llmService → RepoIndexer → UI → Commands
 */
export default class GlyphApp {
    private readonly context: vscode.ExtensionContext;
    private readonly commandManager: CommandManager;

    private glyphConfig!: GlyphConfig;
    private llmHealth!: LLMHealth;
    private llmService!: LLMService;
    private vectorDatabase!: VectorDatabaseService;
    private repositoryIndexer!: RepositoryIndexerService;
    private editorService!: EditorService;
    private editorUI!: EditorUIService;
    private statusBar!: StatusBarService;
    private rangeTracker!: RangeTrackerService;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.commandManager = new CommandManager(context);
    }

    public async initialize(): Promise<void> {
        this.glyphConfig = new GlyphConfig();
        this.llmHealth = new LLMHealth(this.glyphConfig);

        this.vectorDatabase = await VectorDatabaseService.connectGlobalDatabase();
        const workspaceTable = await this.vectorDatabase.initializeWorkspaceTable();

        this.llmService = new LLMService(this.glyphConfig, workspaceTable);

        this.repositoryIndexer = new RepositoryIndexerService(workspaceTable, this.llmService);

        this.editorUI = new EditorUIService();
        this.editorService = new EditorService(this.editorUI, this.glyphConfig);
        this.statusBar = new StatusBarService(this.context);
        this.rangeTracker = new RangeTrackerService(this.context);

        const { model } = this.glyphConfig.getExtensionConfig();
        this.statusBar.setModel(model);

        this.registerCommands();

        const preflightPassed = await this.llmHealth.preflight();
        this.statusBar.setHealthy(preflightPassed);

        if (!preflightPassed) {
            vscode.window.showErrorMessage('Preflight failed — please check the logs for details.');
            return;
        }

        this.startHealthPolling();
        this.registerConfigListener();
    }

    private registerCommands(): void {
        this.commandManager.register(new TestCommand(this.repositoryIndexer));
        this.commandManager.register(
            new GenerateCode(
                this.editorService,
                this.llmService,
                this.editorUI,
                this.statusBar,
                this.rangeTracker,
                this.repositoryIndexer,
            ),
        );
        this.commandManager.register(
            new GenerateDocs(
                this.editorService,
                this.llmService,
                this.editorUI,
                this.statusBar,
                this.rangeTracker,
                this.repositoryIndexer,
            ),
        );
        this.commandManager.register(new ModelSelect(this.glyphConfig, this.llmHealth));
        this.commandManager.register(new CloudProviderOrchestrator(this.context, this.statusBar));
    }

    private startHealthPolling(): void {
        setInterval(async () => {
            const reachable = await this.llmHealth.isReachable();
            this.statusBar.setHealthy(reachable);
        }, 30_000);
    }

    private registerConfigListener(): void {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('glyph.modelName')) {
                const { model } = this.glyphConfig.getExtensionConfig();
                this.statusBar.setModel(model);
            }
        });
    }
}
