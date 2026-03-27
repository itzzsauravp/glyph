import * as vscode from 'vscode';
import GlyphApp from './core/app';

export function activate(context: vscode.ExtensionContext) {
	const glyphApp = new GlyphApp(context);
	glyphApp.initialize().catch(e => console.error(e))
}

export function deactivate() { }
