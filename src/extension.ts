import * as vscode from 'vscode';
import GlyphApp from './core/app';

export async function activate(context: vscode.ExtensionContext) {
	const glyphApp = new GlyphApp(context);
	await glyphApp.initialize();
}

export function deactivate() { }
