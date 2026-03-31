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

export default class GlyphApp {

    private context: vscode.ExtensionContext;
    private ollamaHealth!: OllamaHealth;
    private glyphConfig!: GlyphConfig;
    private ollamaService!: OllamaService;
    private editorService!: EditorService;
    private editorUI!: EditorUIService;
    private statusBar!: StatusBarService;
    private rangeTracker!: RangeTrackerService;
    private readonly cmdMngr: CommandManager;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.cmdMngr = new CommandManager(context);
    }

    public async initialize() {
        this.registerServices();

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
        this.cmdMngr.register(new TestCommand());
        this.cmdMngr.register(new GenerateCode(this.editorService, this.ollamaService, this.editorUI, this.statusBar, this.rangeTracker));
        this.cmdMngr.register(new GenerateDocs(this.editorService, this.ollamaService, this.editorUI, this.statusBar, this.rangeTracker));
        this.cmdMngr.register(new ModelSelect(this.glyphConfig, this.ollamaHealth));
    }

}