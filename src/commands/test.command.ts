import * as vscode from "vscode";
import BaseCommand from "./base.command";

export default class TestCommand extends BaseCommand {

    public id: string = "glyph.test";

    public action = (): void => {
        vscode.window.showInformationMessage('Hey there!!!\nThis is a Starter test command for glyph');
    }

}