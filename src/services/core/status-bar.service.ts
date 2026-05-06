import * as vscode from 'vscode';
import type GlyphConfig from '../../config/glyph.config';

/**
 * Possible states displayed in the status bar.
 */
export enum StatusState {
    Idle = 'Idle',
    GeneratingCode = 'Generating Code',
    GeneratingDocs = 'Generating Docs',
    Offline = 'Offline',
}

/**
 * Manages the Glyph status bar item.
 *
 * Subscribes to {@link GlyphConfig.onDidChange} so that model and provider
 * changes are reflected immediately without manual `setModel()` calls.
 */
export default class StatusBarService {
    private statusBarItem: vscode.StatusBarItem;
    private currentModel: string = '';
    private currentState: StatusState = StatusState.Idle;
    private isHealthy: boolean = true;

    constructor(context: vscode.ExtensionContext, glyphConfig: GlyphConfig) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.statusBarItem.command = 'glyph.model_select';
        context.subscriptions.push(this.statusBarItem);
        this.statusBarItem.show();
        this.update();

        // Auto-sync when config changes.
        glyphConfig.onDidChange((e) => {
            if (e.key === 'model' && typeof e.value === 'string') {
                this.setModel(e.value);
            }
        });
    }

    /**
     * Sets the displayed model name.
     */
    public setModel(model: string): void {
        this.currentModel = model;
        this.update();
    }

    /**
     * Sets the current activity state (Idle, Generating, etc.).
     */
    public setState(state: StatusState): void {
        this.currentState = state;
        this.update();
    }

    /**
     * Updates the health indicator. Offline state is shown when unhealthy.
     */
    public setHealthy(healthy: boolean): void {
        if (!healthy) {
            this.currentState = StatusState.Offline;
        } else if (this.currentState === StatusState.Offline) {
            this.currentState = StatusState.Idle;
        }
        this.isHealthy = healthy;
        this.update();
    }

    /**
     * Refreshes the status bar text and tooltip based on current state.
     */
    private update(): void {
        let icon = '$(check)';
        let text = `Glyph: ${this.currentModel || 'No Model'}`;
        let tooltip = 'Glyph is connected to server';

        if (!this.isHealthy) {
            icon = '$(cloud-off)';
            text = 'Glyph: Server Offline';
            tooltip = 'glyph-server is unreachable. Click to configure or start Docker.';
            this.statusBarItem.command = 'glyph.startServer';
        } else if (
            this.currentState === StatusState.GeneratingCode ||
            this.currentState === StatusState.GeneratingDocs
        ) {
            icon = '$(sync~spin)';
            text = `Glyph: ${this.currentState}...`;
            tooltip = 'AI is generating results';
            this.statusBarItem.command = 'glyph.model_select';
        } else {
            this.statusBarItem.command = 'glyph.model_select';
        }

        this.statusBarItem.text = `${icon} ${text}`;
        this.statusBarItem.tooltip = tooltip;
    }
}
