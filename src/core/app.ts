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
    ModelRegistryService,
    RangeTrackerService,
    ServerClient,
    StatusBarService,
} from '../services';
import BackgroundIndexerService from '../services/core/background-indexer.service';

/**
 * Root application class — owns every service and command.
 *
 * v0.5.0 Architecture:
 *   Config → ServerClient → Health Check → ModelRegistry → UI → Commands
 *
 * All heavy operations (LLM inference, vector indexing, tool execution)
 * are delegated to glyph-server via REST + Socket.IO.
 */
export default class GlyphApp {
    private readonly context: vscode.ExtensionContext;
    private readonly commandManager: CommandManagerService;

    private glyphConfig!: GlyphConfig;
    private serverClient!: ServerClient;
    private modelRegistry!: ModelRegistryService;
    private editorService!: EditorService;
    private editorUI!: EditorUIService;
    private statusBar!: StatusBarService;
    private rangeTracker!: RangeTrackerService;
    private backgroundIndexer!: BackgroundIndexerService;

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

        // ── Server Client ───────────────────────────────────
        this.serverClient = new ServerClient(this.glyphConfig, this.context);

        // ── Model Registry ──────────────────────────────────
        this.modelRegistry = new ModelRegistryService(this.glyphConfig, this.serverClient);

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

        // ── Server Connection ───────────────────────────────
        // Listen for connection state changes to update status bar
        this.serverClient.onConnectionChange((connected) => {
            this.statusBar.setHealthy(connected);
            if (!connected) {
                console.warn('[GlyphApp] Server connection lost');
            }
        });

        // Connect to the server
        await this.serverClient.connect();

        // Initial health check
        const serverHealthy = await this.serverClient.isServerReachable();
        this.statusBar.setHealthy(serverHealthy);

        if (!serverHealthy) {
            vscode.window
                .showWarningMessage(
                    'Glyph: Cannot reach glyph-server. Is it running?',
                    'Start Docker',
                    'Configure URL',
                )
                .then((action) => {
                    if (action === 'Start Docker') {
                        vscode.commands.executeCommand('glyph.startServer');
                    } else if (action === 'Configure URL') {
                        vscode.commands.executeCommand(
                            'workbench.action.openSettings',
                            'glyph.serverUrl',
                        );
                    }
                });
        }

        // Health polling every 30s
        this.startHealthPolling();

        // ── Background Indexer ─────────────────────────────────
        this.backgroundIndexer = new BackgroundIndexerService(this.serverClient, this.context);
        this.backgroundIndexer.start().catch((err) => {
            console.error('[GlyphApp] Background indexer failed:', err);
        });
    }

    /**
     * Registers all extension commands with the VS Code command manager.
     */
    private registerCommands(): void {
        this.commandManager.register(new TestCommand());

        this.commandManager.register(
            new GenerateCode(
                this.editorService,
                this.serverClient,
                this.editorUI,
                this.statusBar,
                this.rangeTracker,
            ),
        );

        this.commandManager.register(
            new GenerateDocs(
                this.editorService,
                this.serverClient,
                this.editorUI,
                this.statusBar,
                this.rangeTracker,
            ),
        );

        this.commandManager.register(new ModelSelect(this.modelRegistry));

        this.commandManager.register(
            new CloudProviderOrchestrator(this.context, this.statusBar, this.glyphConfig, this.serverClient),
        );

        this.commandManager.register(
            new SetupCustomModel(this.context, this.glyphConfig, this.statusBar),
        );

        this.commandManager.register(new ManageApiKeys(this.context));

        const brainstorm = new Brainstorm(
            this.context,
            this.glyphConfig,
            this.serverClient,
            this.modelRegistry,
        );

        this.commandManager.register(brainstorm);

        this.context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer(Brainstorm.viewType, brainstorm),
        );

        this.commandManager.register(new ReloadConfig(this.glyphConfig));
        this.commandManager.register(new RunDiagnosticsCommand(this.serverClient));

        // ── Start Server command ────────────────────────────
        this.context.subscriptions.push(
            vscode.commands.registerCommand('glyph.startServer', async () => {
                const terminal = vscode.window.createTerminal('Glyph Server');
                terminal.sendText('docker compose up -d');
                terminal.show();
                vscode.window.showInformationMessage('Glyph: Starting server via Docker...');
            }),
        );
    }

    /**
     * Polls the server for health every 30 seconds.
     */
    private startHealthPolling(): void {
        setInterval(async () => {
            const reachable = await this.serverClient.isServerReachable();
            this.statusBar.setHealthy(reachable);
        }, 30_000);
    }
}
