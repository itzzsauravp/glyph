import * as vscode from 'vscode';
import CommandManager from './utils/command-manager';
import COMMAND_KEY from "./constants";
import GlyphActions from './commands/actions';
import EditorService from './services/editor.service';
import { ConfigurationManager } from './config/config';

export function activate(context: vscode.ExtensionContext) {

	const editorService = new EditorService()
	const configManager = new ConfigurationManager();

	const glyph = new GlyphActions(editorService, configManager);

	const cmdMngr = new CommandManager(context);

	cmdMngr.register(COMMAND_KEY.GLYPH_TEST, glyph._test);

	cmdMngr.register(COMMAND_KEY.GLYPH_CODE_GENERATOR, glyph.generateCode);
}

export function deactivate() { }
