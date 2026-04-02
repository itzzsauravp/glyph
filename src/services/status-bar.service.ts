import * as vscode from 'vscode';

export enum StatusState {
    Idle = 'Idle',
    GeneratingCode = 'Generating Code',
    GeneratingDocs = 'Generating Docs',
    Offline = 'Offline',
}

export default class StatusBarService {
    private statusBarItem: vscode.StatusBarItem;
    private currentModel: string = '';
    private currentState: StatusState = StatusState.Idle;
    private isHealthy: boolean = true;

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.statusBarItem.command = 'glyph.model_select';
        context.subscriptions.push(this.statusBarItem);
        this.statusBarItem.show();
        this.update();
    }

    public setModel(model: string) {
        this.currentModel = model;
        this.update();
    }

    public setState(state: StatusState) {
        this.currentState = state;
        this.update();
    }

    public setHealthy(healthy: boolean) {
        if (!healthy) {
            this.currentState = StatusState.Offline;
        } else if (this.currentState === StatusState.Offline) {
            this.currentState = StatusState.Idle;
        }
        this.isHealthy = healthy;
        this.update();
    }

    private update() {
        let icon = '$(check)';
        let text = `Glyph: ${this.currentModel || 'No Model'}`;
        let tooltip = 'Ollama is healthy';

        if (!this.isHealthy) {
            icon = '$(circle-slash)';
            text = 'Glyph: Offline';
            tooltip = 'Ollama unreachable';
        } else if (
            this.currentState === StatusState.GeneratingCode ||
            this.currentState === StatusState.GeneratingDocs
        ) {
            icon = '$(sync~spin)';
            text = `Glyph: ${this.currentState}...`;
            tooltip = 'AI is generating results';
        }

        this.statusBarItem.text = `${icon} ${text}`;
        this.statusBarItem.tooltip = tooltip;
    }
}
