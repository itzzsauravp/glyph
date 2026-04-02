import * as vscode from "vscode";

import GlyphConfig from "../config/glyph.config";
import OllamaHealth from "../services/ollama-health.service";
import OllamaService from "../services/ollama.service";
import VectorDatabaseService from "../services/vector-database.service";
import RepositoryIndexerService from "../services/repo-indexer.service";
import EditorService from "../services/editor.service";
import EditorUIService from "../services/editor-ui.service";
import StatusBarService from "../services/status-bar.service";
import RangeTrackerService from "../services/range-tracker.service";
import CommandManager from "../services/command-manager.service";

import TestCommand from "../commands/test.command";
import GenerateCode from "../commands/generate-code.command";
import GenerateDocs from "../commands/generate-docs.command";
import ModelSelect from "../commands/model-select.command";

/**
 * Root application class — owns every service and command.
 *
 * Initialization follows a strict sequential order so that every
 * dependency is fully resolved before it is handed to its consumers.
 *
 *   Config → Health → VectorDB → OllamaService → RepoIndexer → UI → Commands
 */
export default class GlyphApp {

    private readonly context: vscode.ExtensionContext;
    private readonly commandManager: CommandManager;

    private glyphConfig!: GlyphConfig;
    private ollamaHealth!: OllamaHealth;
    private ollamaService!: OllamaService;
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
        this.ollamaHealth = new OllamaHealth(this.glyphConfig);

        this.vectorDatabase = await VectorDatabaseService.connectGlobalDatabase();
        const workspaceTable = await this.vectorDatabase.initializeWorkspaceTable();

        this.ollamaService = new OllamaService(this.glyphConfig, workspaceTable);

        this.repositoryIndexer = new RepositoryIndexerService(workspaceTable, this.ollamaService);

        this.editorUI = new EditorUIService();
        this.editorService = new EditorService(this.editorUI, this.glyphConfig);
        this.statusBar = new StatusBarService(this.context);
        this.rangeTracker = new RangeTrackerService(this.context);

        const { model } = this.glyphConfig.getExtensionConfig();
        this.statusBar.setModel(model);

        this.registerCommands();

        const preflightPassed = await this.ollamaHealth.preflight();
        this.statusBar.setHealthy(preflightPassed);

        if (!preflightPassed) {
            vscode.window.showErrorMessage("Preflight failed — please check the logs for details.");
            return;
        }

        this.startHealthPolling();
        this.registerConfigListener();
    }

    private registerCommands(): void {
        this.commandManager.register(
            new TestCommand(this.repositoryIndexer),
        );
        this.commandManager.register(
            new GenerateCode(
                this.editorService,
                this.ollamaService,
                this.editorUI,
                this.statusBar,
                this.rangeTracker,
                this.repositoryIndexer,
            ),
        );
        this.commandManager.register(
            new GenerateDocs(
                this.editorService,
                this.ollamaService,
                this.editorUI,
                this.statusBar,
                this.rangeTracker,
                this.repositoryIndexer,
            ),
        );
        this.commandManager.register(
            new ModelSelect(this.glyphConfig, this.ollamaHealth),
        );
    }

    private startHealthPolling(): void {
        setInterval(async () => {
            const reachable = await this.ollamaHealth.isReachable();
            this.statusBar.setHealthy(reachable);
        }, 30_000);
    }

    private registerConfigListener(): void {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("glyph.modelName")) {
                const { model } = this.glyphConfig.getExtensionConfig();
                this.statusBar.setModel(model);
            }
        });
    }
}