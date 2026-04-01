import * as vscode from "vscode";
import GlyphConfig from "../config/glyph.config";
import OllamaService from "../services/ollama.service";
import EditorService from "../services/editor.service";
import EditorUIService from "../services/editor-ui.service";
import OllamaHealth from "../services/ollama-health.service";
import CommandManager from "../services/command-manager.service";
import TestCommand from "../commands/test.command";
import GenerateCode from "../commands/generate-code.command";
import GenerateDocs from "../commands/generate-docs.command";
import ModelSelect from "../commands/model-select.command";
import StatusBarService from "../services/status-bar.service";
import RangeTrackerService from "../services/range-tracker.service";
import VectorDatabaseService from "../services/vector-database.service";
import RepositoryIndexerService from "../services/repo-indexer.service";

export default class GlyphApp {

    private context: vscode.ExtensionContext;
    private ollamaHealth!: OllamaHealth;
    private glyphConfig!: GlyphConfig;
    private ollamaService!: OllamaService;
    private editorService!: EditorService;
    private editorUI!: EditorUIService;
    private statusBar!: StatusBarService;
    private rangeTracker!: RangeTrackerService;
    private vectorDatabaseService!: VectorDatabaseService;
    private repositoryIndexer!: RepositoryIndexerService;
    private readonly commandManager: CommandManager;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.commandManager = new CommandManager(context);
    }

    /**
     * Connects to the global LanceDB database, initialises the workspace table,
     * and runs a mock indexing test to verify the pipeline works end-to-end.
     */
    private async initializeVectorSearch(): Promise<void> {
        try {

            this.vectorDatabaseService = await VectorDatabaseService.connectGlobalDatabase();

            const activeWorkspaceName = vscode.workspace.name || "default_workspace";

            const workspaceTable = await this.vectorDatabaseService.initializeWorkspaceTable(activeWorkspaceName);

            this.repositoryIndexer = new RepositoryIndexerService(workspaceTable, this.ollamaService);

        } catch (error) {
            console.error("[GlyphApp]:  initializeVectorSearch() FAILED:", error);
        }
    }

    public async initialize() {
        // Services (including OllamaService) must be registered first so they
        // are available to be injected into RepositoryIndexerService.
        this.registerServices();

        await this.initializeVectorSearch();

        this.registerCommands();


        const preflightPassed = await this.ollamaHealth.preflight();
        this.statusBar.setHealthy(preflightPassed);

        this.startHealthPolling();
        this.registerConfigListener();

        if (!preflightPassed) {
            vscode.window.showErrorMessage("Preflight failed, please check the logs to see why");
            return;
        }
    }

    private registerServices() {
        this.glyphConfig = new GlyphConfig();
        this.ollamaHealth = new OllamaHealth(this.glyphConfig);
        this.ollamaService = new OllamaService(this.glyphConfig);
        this.editorUI = new EditorUIService();
        this.editorService = new EditorService(this.editorUI, this.glyphConfig);
        this.statusBar = new StatusBarService(this.context);
        this.rangeTracker = new RangeTrackerService(this.context);

        const { model } = this.glyphConfig.getExtensionConfig();
        this.statusBar.setModel(model);
    }

    private startHealthPolling() {
        setInterval(async () => {
            const reachable = await this.ollamaHealth.isReachable();
            this.statusBar.setHealthy(reachable);
        }, 30000);
    }

    private registerConfigListener() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('glyph.modelName')) {
                const { model } = this.glyphConfig.getExtensionConfig();
                this.statusBar.setModel(model);
            }
        });
    }

    private registerCommands() {
        this.commandManager.register(new TestCommand(this.repositoryIndexer));
        this.commandManager.register(new GenerateCode(this.editorService, this.ollamaService, this.editorUI, this.statusBar, this.rangeTracker));
        this.commandManager.register(new GenerateDocs(this.editorService, this.ollamaService, this.editorUI, this.statusBar, this.rangeTracker));
        this.commandManager.register(new ModelSelect(this.glyphConfig, this.ollamaHealth));
    }

}