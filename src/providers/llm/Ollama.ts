import { ConfigurationManager } from "../../config/config";
import LLMService from "./base";

// TODO: find whats models user has installed and give them to choose form the list of modles
export default class OllamaService extends LLMService {

    constructor(private readonly configManager: ConfigurationManager) {
        super();
    }

    private extractCode(text: string): string {
        const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
        return match ? match[1].trim() : text;
    }

    private extractConfig() {
        return this.configManager.getExtensionConfig()
    }

    public async generateCode(prompt: string, code: string): Promise<string> {
        const { endpoint, model } = this.extractConfig()
        const systemPrompt = `
        You are a specialized programming assistant. 
        Your task is to modify the provided code according to the instructions.
        RULES:
        1. Return ONLY the functional code.
        2. Do NOT include markdown code blocks (no \`\`\` or \`\`\`typescript).
        3. Do NOT provide explanations, comments, or usage examples.
        4. If the instruction is 'Refactor', return the full refactored code.
        5. Do not include any backtiks.
    `;
        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                system: systemPrompt,
                model,
                prompt: `Instructions: ${prompt}\n\nCode to modify:\n${code}`,
                stream: false
            })
        });
        const data = await response.json() as any;
        return this.extractCode(data.response);
    }

    public async generateDocs(code: string, languageId: string): Promise<string> {
        const { endpoint, model } = this.extractConfig();

        const systemPrompt = `
        You are an expert technical writer and developer.
        Your task is to generate the most appropriate documentation comment for the provided code in ${languageId}.
        
        RULES:
        1. Return ONLY the documentation comment block.
        2. Use the standard "Docstring" format for ${languageId} that enables IDE hover/IntelliSense.
           - Examples: /** */ for JS/TS/Java/C++, ''' ''' or """ """ for Python, /// for C# / Rust.
        3. Do NOT return the function code itself.
        4. Do NOT include markdown code blocks (\`\`\`).
        5. Do not include any backtiks.
        6. Focus on parameters, return values, and a brief summary.
    `;

        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                model,
                system: systemPrompt,
                prompt: `Code to document:\n${code}`,
                stream: false,
                options: {
                    temperature: 0.1,
                    stop: ["function", "class", "def ", "public "]
                }
            })
        });

        const data = await response.json() as any;
        return this.extractCode(data.response);
    }

}