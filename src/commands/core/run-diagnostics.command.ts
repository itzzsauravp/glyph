import * as vscode from 'vscode';
import type { LLMHealth } from '../../services';
import BaseCommand from '../core/base.command';

/**
 * Runs a comprehensive diagnostic across all configured providers
 * and displays the results in an information message with details
 * in the output channel.
 */
export default class RunDiagnosticsCommand extends BaseCommand {
    public readonly id = 'glyph.run_diagnostics';

    constructor(private readonly llmHealth: LLMHealth) {
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
                const report = await this.llmHealth.runFullDiagnostic();

                let totalPassed = 0;
                let totalFailed = 0;
                const lines: string[] = ['── Glyph Diagnostic Report ──\n'];

                for (const [provider, results] of report) {
                    lines.push(`▸ ${provider}`);
                    for (const r of results) {
                        const icon = r.passed ? '  ✓' : '  ✗';
                        lines.push(`${icon} ${r.check}${r.detail ? ` — ${r.detail}` : ''}`);
                        if (r.passed) totalPassed++;
                        else totalFailed++;
                    }
                    lines.push('');
                }

                lines.push(`Summary: ${totalPassed} passed, ${totalFailed} failed`);

                // Show in output channel
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
