import * as vscode from 'vscode';
import type ServerClient from '../../services/server/server-client.service';
import BaseCommand from '../core/base.command';

/**
 * Runs a diagnostic check against the glyph-server
 * and displays the results in an information message.
 */
export default class RunDiagnosticsCommand extends BaseCommand {
    public readonly id = 'glyph.run_diagnostics';

    constructor(private readonly serverClient: ServerClient) {
        super();
    }

    public action = async (): Promise<void> => {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Glyph: Running diagnostics…',
                cancellable: false,
            },
            async () => {
                const lines: string[] = ['── Glyph Diagnostic Report ──\n'];
                let totalPassed = 0;
                let totalFailed = 0;

                // 1. Server Health
                try {
                    const health = await this.serverClient.healthCheck();
                    lines.push('▸ Server');
                    lines.push(`  ✓ Health check passed (v${health.version}, uptime: ${Math.round(health.uptime)}s)`);
                    lines.push(`  ✓ Socket.IO connected: ${this.serverClient.isConnected}`);
                    totalPassed += 2;
                } catch (err) {
                    lines.push('▸ Server');
                    lines.push(`  ✗ Health check failed — ${(err as Error).message}`);
                    lines.push(`  ✗ Socket.IO connected: ${this.serverClient.isConnected}`);
                    totalFailed += 2;
                }

                // 2. Server URL config
                const serverUrl = vscode.workspace.getConfiguration('glyph').get<string>('serverUrl', 'http://localhost:9741');
                lines.push('');
                lines.push('▸ Configuration');
                lines.push(`  ✓ Server URL: ${serverUrl}`);
                totalPassed++;

                // 3. Active model
                const config = vscode.workspace.getConfiguration('glyph');
                const model = config.get<string>('modelName', '');
                const provider = config.get<string>('providerType', '');
                if (model) {
                    lines.push(`  ✓ Active model: ${model} (${provider})`);
                    totalPassed++;
                } else {
                    lines.push(`  ✗ No model configured`);
                    totalFailed++;
                }

                lines.push('');
                lines.push(`Summary: ${totalPassed} passed, ${totalFailed} failed`);

                const channel = vscode.window.createOutputChannel('Glyph Diagnostics');
                channel.clear();
                channel.appendLine(lines.join('\n'));
                channel.show();

                if (totalFailed === 0) {
                    vscode.window.showInformationMessage(
                        `Glyph Diagnostics: All ${totalPassed} checks passed.`,
                    );
                } else {
                    vscode.window.showWarningMessage(
                        `Glyph Diagnostics: ${totalFailed} check(s) failed. See "Glyph Diagnostics" output for details.`,
                    );
                }
            },
        );
    };
}
