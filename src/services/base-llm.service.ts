export default abstract class LLMService {
    public abstract generateCode(prompt: string, code: string, languageId: string): Promise<string>
    public abstract generateDocs(code: string, languageId: string): Promise<string>
}