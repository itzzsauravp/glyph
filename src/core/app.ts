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

export default class GlyphApp {

    private ollamaHealth!: OllamaHealth;
    private glyphConfig!: GlyphConfig;
    private ollamaService!: OllamaService;
    private editorService!: EditorService;
    private editorUI!: EditorUIService;
    private readonly cmdMngr: CommandManager;

    constructor(context: vscode.ExtensionContext) {
        this.ollamaHealth = new OllamaHealth();
        this.glyphConfig = new GlyphConfig();
        this.ollamaService = new OllamaService(this.glyphConfig);
        this.editorUI = new EditorUIService();
        this.editorService = new EditorService(this.editorUI);
        this.cmdMngr = new CommandManager(context);
    }

    public async initialize() {
        this.registerServices();

        // Register commands immediately so VS Code knows they exist upon activation.
        this.registerCommands();

        // Non-blocking preflight check for Ollama.
        const preflightPassed = await this.ollamaHealth.preflight();
        if (!preflightPassed) {
            vscode.window.showErrorMessage("Preflight failed, please check the logs to see why");
            return;
        }
    }

    private registerServices() {
        this.ollamaHealth = new OllamaHealth();
        this.glyphConfig = new GlyphConfig();
        this.ollamaService = new OllamaService(this.glyphConfig);
        this.editorUI = new EditorUIService();
        this.editorService = new EditorService(this.editorUI);
    }

    private registerCommands() {
        this.cmdMngr.register(new TestCommand());
        this.cmdMngr.register(new GenerateCode(this.editorService, this.ollamaService, this.editorUI));
        this.cmdMngr.register(new GenerateDocs(this.editorService, this.ollamaService, this.editorUI));
        this.cmdMngr.register(new ModelSelect(this.glyphConfig, this.ollamaHealth));
    }

}