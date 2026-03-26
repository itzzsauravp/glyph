import * as vscode from "vscode";

export default class CommandManager {
    constructor(private readonly context: vscode.ExtensionContext) { }

    register(commandsRegisteredName: string, action: () => void) {
        const disposable = vscode.commands.registerCommand(commandsRegisteredName, action);
        this.context.subscriptions.push(disposable);
    }
}