import LLMService from "./base";

export default class OllamaService extends LLMService {

    extractCode(text: string): string {
        const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
        return match ? match[1].trim() : text;
    }

    public async generate(prompt: string, code: string): Promise<string> {

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
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            body: JSON.stringify({
                system: systemPrompt,
                model: 'qwen2.5:1.5b',
                prompt: `Instructions: ${prompt}\n\nCode to modify:\n${code}`,
                stream: false
            })
        });
        const data = await response.json() as any;
        return this.extractCode(data.response);
    }


}