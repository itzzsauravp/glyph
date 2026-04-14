import { z } from 'zod';
import { tool } from 'ai';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export type PermissionRequester = (toolName: string, details: string) => Promise<boolean>;

/**
 * Registry of all tools available to the AI model.
 *
 * Tools are split into two categories:
 * - **Read tools**: Free, unrestricted access (no permission needed)
 * - **Write tools**: Require explicit user permission via HITL
 */
export class ToolRegistry {
    constructor(
        private readonly workspaceRoot: string,
        private readonly onRequestPermission?: PermissionRequester
    ) {}

    /**
     * HITL permission gate — only used for write/execute operations.
     */
    private async withPermission<T>(
        toolName: string,
        details: string,
        action: () => Promise<T | string>
    ): Promise<T | string> {
        if (!this.onRequestPermission) {
            return `Error: Permission system unavailable. Write/execute tools require permission.`;
        }

        const approved = await this.onRequestPermission(toolName, details);
        if (!approved) {
            return `User denied permission to execute ${toolName}.`;
        }

        return action();
    }

    // ── Read Tools (FREE — no permission required) ─────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private buildReadTools(): Record<string, any> {
        return {
            list_project_structure: tool({
                description: 'Returns the directory tree of the workspace.',
                parameters: z.object({
                    depth: z.number().optional().describe('Max folder depth to show (default: 3)'),
                }),
                execute: async (args) => {
                    try {
                        const { tree } = require('tree-node-cli');
                        return tree(this.workspaceRoot, {
                            allFiles: true,
                            exclude: [/node_modules/, /\.git/, /\.glyph/, /dist/, /out/],
                            maxDepth: args.depth ?? 3,
                            trailingSlash: true,
                        });
                    } catch (e: any) {
                        return `Error listing project structure: ${e.message || String(e)}`;
                    }
                },
            }),
            read_file_content: tool({
                description: 'Reads the full source content of a specific file in the workspace.',
                parameters: z.object({
                    relativePath: z.string().describe('The relative path of the file from the workspace root'),
                }),
                execute: async (args) => {
                    if (!args.relativePath) return `Error: Missing relativePath.`;
                    try {
                        const absPath = path.resolve(this.workspaceRoot, args.relativePath);
                        const content = nodeFs.readFileSync(absPath, 'utf-8');
                        return content.slice(0, 20000);
                    } catch {
                        return `Error: Could not read file "${args.relativePath}".`;
                    }
                },
            }),
            read_lines: tool({
                description: 'Reads specific lines from a file in the workspace.',
                parameters: z.object({
                    relativePath: z.string().describe('The relative path of the file'),
                    startLine: z.number().describe('1-based index for the start line'),
                    endLine: z.number().describe('1-based index for the end line'),
                }),
                execute: async (args) => {
                    if (!args.relativePath || !args.startLine || !args.endLine) return `Error: Missing required parameters.`;
                    try {
                        const absPath = path.resolve(this.workspaceRoot, args.relativePath);
                        const content = nodeFs.readFileSync(absPath, 'utf-8');
                        const lines = content.split('\n');
                        const snippet = lines.slice(Math.max(0, args.startLine - 1), args.endLine).join('\n');
                        return snippet || `No content in specified range`;
                    } catch {
                        return `Error: Could not read lines from "${args.relativePath}".`;
                    }
                },
            }),
            search_codebase: tool({
                description: 'Performs a keyword text search across all source files.',
                parameters: z.object({
                    query: z.string().describe('The exact keyword or pattern to search for'),
                    fileGlob: z.string().optional().describe('Optional glob to narrow search'),
                }),
                execute: async (args) => {
                    if (!args.query) return `Error: Missing query.`;
                    try {
                        const pattern = args.fileGlob ?? '**/*.{ts,js,py,go,rs,java,md}';
                        const uris = await vscode.workspace.findFiles(pattern, '{node_modules,dist,.git}/**', 200);
                        const results: string[] = [];
                        for (const uri of uris) {
                            const doc = await vscode.workspace.openTextDocument(uri);
                            const rel = path.relative(this.workspaceRoot, uri.fsPath);
                            doc.getText().split('\n').forEach((line: string, i: number) => {
                                if (line.toLowerCase().includes(args.query.toLowerCase())) {
                                    results.push(`${rel}:${i + 1}: ${line.trim()}`);
                                }
                            });
                            if (results.length > 200) break;
                        }
                        return results.join('\n') || `No matches found for "${args.query}"`;
                    } catch (e: any) {
                        return `Search error: ${e.message || String(e)}`;
                    }
                },
            }),
            grep_search: tool({
                description: 'Performs regex text search.',
                parameters: z.object({
                    regexPattern: z.string().describe('The regex pattern to search for'),
                    fileGlob: z.string().optional().describe('Optional glob to narrow search'),
                }),
                execute: async (args) => {
                    if (!args.regexPattern) return `Error: Missing regexPattern.`;
                    try {
                        const regex = new RegExp(args.regexPattern, 'i');
                        const pattern = args.fileGlob ?? '**/*.{ts,js,py,go,rs,java,md}';
                        const uris = await vscode.workspace.findFiles(pattern, '{node_modules,dist,.git}/**', 300);
                        const results: string[] = [];
                        for (const uri of uris) {
                            const doc = await vscode.workspace.openTextDocument(uri);
                            const rel = path.relative(this.workspaceRoot, uri.fsPath);
                            doc.getText().split('\n').forEach((line: string, i: number) => {
                                if (regex.test(line)) {
                                    results.push(`${rel}:${i + 1}: ${line.trim()}`);
                                }
                            });
                            if (results.length > 300) break;
                        }
                        return results.join('\n') || `No matches found for regex "${args.regexPattern}"`;
                    } catch (e: any) {
                        return `Grep error: ${e.message || String(e)}`;
                    }
                },
            }),
            list_workspace_files: tool({
                description: 'Lists all file paths in the workspace matching a glob pattern.',
                parameters: z.object({
                    glob: z.string().optional().describe('Glob pattern (default: **/*.ts)'),
                }),
                execute: async (args) => {
                    try {
                        const pattern = args.glob ?? '**/*.{ts,js,py,go,rs,java,md,json}';
                        const uris = await vscode.workspace.findFiles(pattern, '{node_modules,dist,.git}/**', 300);
                        return uris.map((u: vscode.Uri) => path.relative(this.workspaceRoot, u.fsPath)).join('\n');
                    } catch (e: any) {
                        return `Error listing files: ${e.message || String(e)}`;
                    }
                },
            }),
        };
    }

    // ── Write Tools (PERMISSION REQUIRED via HITL) ─────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private buildWriteTools(): Record<string, any> {
        return {
            create_file: tool({
                description: 'Creates a new file with the specified content. Requires user permission.',
                parameters: z.object({
                    relativePath: z.string().describe('Path where the new file should be created'),
                    content: z.string().describe('The complete source code or content to write to the file'),
                }),
                execute: async (args) => {
                    const { relativePath, content } = args;
                    if (!relativePath || !content) return `Error: Missing parameters.`;

                    return this.withPermission('create_file', `Create: ${relativePath}`, async () => {
                        try {
                            const absPath = path.resolve(this.workspaceRoot, relativePath);
                            const dir = path.dirname(absPath);
                            if (!nodeFs.existsSync(dir)) {
                                nodeFs.mkdirSync(dir, { recursive: true });
                            }
                            nodeFs.writeFileSync(absPath, content, 'utf-8');
                            return `Successfully created file ${relativePath}`;
                        } catch (e: any) {
                            return `Error creating file: ${e.message || String(e)}`;
                        }
                    });
                },
            }),
            edit_file: tool({
                description: 'Overwrites an existing file with new content. Requires user permission.',
                parameters: z.object({
                    relativePath: z.string().describe('Path of the existing file to edit'),
                    content: z.string().describe('The complete new content that will overwrite the entire file'),
                }),
                execute: async (args) => {
                    const { relativePath, content } = args;
                    if (!relativePath || !content) return `Error: Missing parameters.`;

                    return this.withPermission('edit_file', `Edit: ${relativePath}`, async () => {
                        try {
                            const absPath = path.resolve(this.workspaceRoot, relativePath);
                            if (!nodeFs.existsSync(absPath)) return `Error: File ${relativePath} does not exist.`;
                            nodeFs.writeFileSync(absPath, content, 'utf-8');
                            return `Successfully updated file ${relativePath}`;
                        } catch (e: any) {
                            return `Error editing file: ${e.message || String(e)}`;
                        }
                    });
                },
            }),
            run_command: tool({
                description: 'Runs a terminal command in the workspace. Requires user permission.',
                parameters: z.object({
                    command: z.string().describe('The terminal command to run'),
                }),
                execute: async (args) => {
                    const { command } = args;
                    if (!command) return `Error: Missing command.`;
                    return this.withPermission('run_command', `Terminal: ${command}`, async () => {
                        try {
                            const { stdout, stderr } = await execAsync(command, { cwd: this.workspaceRoot });
                            const output = [];
                            if (stdout) output.push(`STDOUT:\n${stdout.slice(0, 10000)}`);
                            if (stderr) output.push(`STDERR:\n${stderr.slice(0, 10000)}`);
                            return output.length > 0 ? output.join('\n') : 'Command executed successfully.';
                        } catch (e: any) {
                            return `Command failed: ${e.message || String(e)}`;
                        }
                    });
                },
            }),
        };
    }

    // ── Public API ─────────────────────────────────────────────────

    /**
     * Returns ONLY read tools (free access, no permission gate).
     * Used for code generation and context-gathering flows.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getReadOnlyTools(): Record<string, any> {
        return this.buildReadTools();
    }

    /**
     * Returns ALL tools (read + write).
     * Read tools execute freely; write tools require HITL permission.
     * Used for brainstorm chat sessions.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getTools(): Record<string, any> {
        return {
            ...this.buildReadTools(),
            ...this.buildWriteTools(),
        };
    }
}
