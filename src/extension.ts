import * as vscode from 'vscode';
import CommandManager from './utils/command-manager';
import COMMAND_KEY from "./constants";
import GlyphActions from './commands/actions';
import EditorService from './services/editor.service';
import { ConfigurationManager } from './config/config';
import OllamaHealth from './services/ollama-health.service';
import OllamaService from './providers/llm/Ollama';

export function activate(context: vscode.ExtensionContext) {
	const ollamaHealth = new OllamaHealth();
	const configManager = new ConfigurationManager();
	const ollama = new OllamaService(configManager);
	const editorService = new EditorService();

	// run preflight test
	const preflightPassed = ollamaHealth.preflight();
	if (!preflightPassed) {
		vscode.window.showErrorMessage("Preflight failed, please check to logs to see why")
		return
	}

	const glyph = new GlyphActions(editorService, ollama);

	const cmdMngr = new CommandManager(context);

	cmdMngr.register(COMMAND_KEY.GLYPH_TEST, glyph._test);

	cmdMngr.register(COMMAND_KEY.GLYPH_CODE_GENERATOR, glyph.generateCode);

	cmdMngr.register(COMMAND_KEY.GLYPH_DOCS_GENERATOR, glyph.generateDocs);
}

export function deactivate() { }
