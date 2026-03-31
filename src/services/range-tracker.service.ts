import * as vscode from 'vscode';

interface ActiveRange {
    id: string;
    uri: string;
    range: vscode.Range;
}

export default class RangeTrackerService {
    private activeRanges: Map<string, ActiveRange> = new Map();

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(event => this.handleDocumentChange(event))
        );
    }

    public register(uri: vscode.Uri, range: vscode.Range): string {
        const id = Math.random().toString(36).substring(7);
        this.activeRanges.set(id, { id, uri: uri.toString(), range });
        return id;
    }

    public getRange(id: string): vscode.Range | undefined {
        return this.activeRanges.get(id)?.range;
    }

    public unregister(id: string) {
        this.activeRanges.delete(id);
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        const uri = event.document.uri.toString();
        const changes = event.contentChanges;

        for (const [id, active] of this.activeRanges) {
            if (active.uri !== uri) continue;

            let currentRange = active.range;

            for (const change of changes) {
                if (change.range.end.isBeforeOrEqual(currentRange.start)) {
                    const lineDelta = this.calculateLineDelta(change);
                    const charDelta = this.calculateCharDelta(change, currentRange.start);

                    currentRange = new vscode.Range(
                        new vscode.Position(currentRange.start.line + lineDelta, currentRange.start.character + charDelta),
                        new vscode.Position(currentRange.end.line + lineDelta, currentRange.end.character + charDelta)
                    );
                }
                else if (change.range.start.isAfterOrEqual(currentRange.start) && change.range.end.isBeforeOrEqual(currentRange.end)) {
                    const lineDelta = this.calculateLineDelta(change);
                    currentRange = new vscode.Range(
                        currentRange.start,
                        new vscode.Position(currentRange.end.line + lineDelta, currentRange.end.character)
                    );
                }
            }

            active.range = currentRange;
        }
    }

    private calculateLineDelta(change: vscode.TextDocumentContentChangeEvent): number {
        const linesAdded = change.text.split('\n').length - 1;
        const linesRemoved = change.range.end.line - change.range.start.line;
        return linesAdded - linesRemoved;
    }

    private calculateCharDelta(change: vscode.TextDocumentContentChangeEvent, rangeStart: vscode.Position): number {
        if (change.range.end.line !== rangeStart.line) return 0;

        const linesAdded = change.text.split('\n').length - 1;
        if (linesAdded > 0) return 0;

        const charsAdded = change.text.length;
        const charsRemoved = change.range.end.character - change.range.start.character;
        return charsAdded - charsRemoved;
    }
}
