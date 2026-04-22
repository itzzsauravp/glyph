import * as vscode from 'vscode';
import {
    Brainstorm,
    CloudProviderOrchestrator,
    GenerateCode,
    GenerateDocs,
    ManageApiKeys,
    ModelSelect,
    ReloadConfig,
    RunDiagnosticsCommand,
    SetupCustomModel,
    TestCommand,
} from '../commands';
import GlyphConfig from '../config/glyph.config';
import {
    CommandManagerService,
    EditorService,
    EditorUIService,
    LLMHealth,
    LLMService,
    ModelRegistryService,
    RangeTrackerService,
    RepositoryIndexerService,
    StatusBarService,
    VectorDatabaseService,
} from '../services';

/**
 * Root application class — owns every service and command.
 *
 * Initialization follows a strict sequential order so that every
 * dependency is fully resolved before it is handed to its consumers.
 *
 *   Config → Health → VectorDB → LLMService → ModelRegistry → RepoIndexer → UI → Commands
 */
export default class GlyphApp {
    private readonly context: vscode.ExtensionContext;
    private readonly commandManager: CommandManagerService;

    private glyphConfig!: GlyphConfig;
    private llmHealth!: LLMHealth;
    private llmService!: LLMService;
    private modelRegistry!: ModelRegistryService;
    private vectorDatabase!: VectorDatabaseService;
    private repositoryIndexer!: RepositoryIndexerService;
    private editorService!: EditorService;
    private editorUI!: EditorUIService;
    private statusBar!: StatusBarService;
    private rangeTracker!: RangeTrackerService;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.commandManager = new CommandManagerService(context);
    }

    /**
     * Bootstraps all services and registers every command.
     */
    public async initialize(): Promise<void> {
        // ── Core Config ─────────────────────────────────────
        this.glyphConfig = new GlyphConfig(this.context);
        this.llmHealth = new LLMHealth(this.glyphConfig);

        // ── Database ────────────────────────────────────────
        this.vectorDatabase = await VectorDatabaseService.connectGlobalDatabase();
        const workspaceTable = await this.vectorDatabase.initializeWorkspaceTable();

        // ── AI Services ─────────────────────────────────────
        this.llmService = new LLMService(this.glyphConfig, workspaceTable);
        this.modelRegistry = new ModelRegistryService(this.glyphConfig);

        // ── Indexer ─────────────────────────────────────────
        this.repositoryIndexer = new RepositoryIndexerService(workspaceTable, this.llmService);

        // ── UI Services ─────────────────────────────────────
        this.editorUI = new EditorUIService();
        this.editorService = new EditorService(this.editorUI, this.glyphConfig);
        this.statusBar = new StatusBarService(this.context, this.glyphConfig);
        this.rangeTracker = new RangeTrackerService(this.context);

        // Set initial model display.
        const { model } = this.glyphConfig.getExtensionConfig();
        this.statusBar.setModel(model);

        // ── Commands ────────────────────────────────────────
        this.registerCommands();

        // ── Preflight ───────────────────────────────────────
        const preflightPassed = await this.llmHealth.preflight();
        this.statusBar.setHealthy(preflightPassed);

        if (!preflightPassed) {
            vscode.window.showErrorMessage('Preflight failed — please check the logs for details.');
            return;
        }

        this.startHealthPolling();
    }

    /**
     * Registers all extension commands with the VS Code command manager.
     */
    private registerCommands(): void {
        this.commandManager.register(new TestCommand());

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

        this.commandManager.register(new ModelSelect(this.modelRegistry));

        this.commandManager.register(
            new CloudProviderOrchestrator(this.context, this.statusBar, this.glyphConfig),
        );

        this.commandManager.register(
            new SetupCustomModel(this.context, this.glyphConfig, this.statusBar),
        );

        this.commandManager.register(new ManageApiKeys(this.context));

        const brainstorm = new Brainstorm(
            this.context,
            this.glyphConfig,
            this.llmService,
            this.modelRegistry,
            this.repositoryIndexer,
        );

        this.commandManager.register(brainstorm);

        this.context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer(Brainstorm.viewType, brainstorm),
        );

        this.commandManager.register(new ReloadConfig(this.glyphConfig));
        this.commandManager.register(new RunDiagnosticsCommand(this.llmHealth));
    }

    /**
     * Polls the active provider for health every 30 seconds.
     */
    private startHealthPolling(): void {
        setInterval(async () => {
            const reachable = await this.llmHealth.isReachable();
            this.statusBar.setHealthy(reachable);
        }, 30_000);
    }
}
