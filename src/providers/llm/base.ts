export default abstract class LLMService {
    public abstract generate(prompt: string, code: string): Promise<string>
}