import * as vscode from 'vscode';
import type BaseCommand from '../commands/base.command';

export default class CommandManager {
    constructor(private readonly context: vscode.ExtensionContext) {}

    register(command: BaseCommand) {
        const disposable = vscode.commands.registerCommand(command.id, command.action);
        this.context.subscriptions.push(disposable);
    }
}
