export default abstract class LLMService {
    public abstract generateCode(prompt: string, code: string): Promise<string>
    public abstract generateDocs(prompt: string, code: string): Promise<string>
}