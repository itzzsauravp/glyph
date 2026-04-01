import * as vscode from "vscode";

export default abstract class LLMService {
    public abstract generateCode(prompt: string, code: string, languageId: string): Promise<string>;
    public abstract generateDocs(code: string, languageId: string): Promise<string>;
    public abstract generateCodeWithContext(prompt: string, code: string, languageId: string, documentUri: vscode.Uri): Promise<string>;
    public abstract generateDocsWithContext(code: string, languageId: string, documentUri: vscode.Uri): Promise<string>;
}