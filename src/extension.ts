import * as vscode from 'vscode';
import CommandManager from './utils/command-manager';
import COMMAND_KEY from "./constants";
import { glyphCodeGenerator, glyphTest } from './commands/actions';

export function activate(context: vscode.ExtensionContext) {
	const cmdMngr = new CommandManager(context);

	cmdMngr.register(COMMAND_KEY.GLYPH_TEST, glyphTest);

	cmdMngr.register(COMMAND_KEY.GLYPH_CODE_GENERATOR, glyphCodeGenerator);
}

export function deactivate() { }
