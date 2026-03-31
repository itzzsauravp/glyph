# Glyph 🪶

Glyph is a local-first AI assistant extension for Visual Studio Code, powered entirely by [Ollama](https://ollama.com/). 

Designed for learners, minimalists, and privacy-conscious developers, Glyph provides **"micro-interventions"** rather than intrusive, full-scale AI workflows. It gets out of your way, putting you—the developer—back in complete control of your codebase.

---

## ✨ Features

- **Micro-Completions:** Highlight a block of code, press a shortcut, and let Glyph generate missing pieces or refactor it based on a simple prompt. No ghost text trying to autocomplete every keypress.
- **Auto-Documentation:** Instantly generate rich, standard docstrings for your functions and classes with a single command. 
- **Privacy First (Local Only):** Your code never leaves your machine. Glyph communicates exclusively with your local Ollama instance.
- **Customizable:** Pin your preferred LLM model and endpoint through the VS Code settings.

---

## 🛠️ Prerequisites

1. **[Ollama](https://ollama.com/)** must be installed and running on your machine.
2. At least one model must be pulled locally. For example:
   ```bash
   ollama run llama3
   ```
   *Any model supported by Ollama will work. We recommend `llama3` or `phi3` for code tasks.*

---

## 🏗️ Architecture & Philosophy

Glyph is built using a cleanly separated, class-based architecture that leverages Dependency Injection. This makes the codebase robust, scalable, and extremely welcoming for open-source contributors.

### Folder Structure
```text
src/
 ├── commands/            # Individual, localized user commands (e.g., generate-code, generate-docs)
 ├── config/              # User settings and environment configuration
 ├── core/                # Bootstrap, app lifecycle, and extension entrypoint
 └── services/            # DI-managed services (EditorUI, Ollama client, health checks)
```

### Code Tour Example

**Service Orchestration:** All services are cleanly injected in `app.ts` ensuring a single source of truth without hidden singletons.
```typescript
// src/core/app.ts
private registerServices() {
    this.ollamaHealth = new OllamaHealth();
    this.glyphConfig = new GlyphConfig();
    this.ollamaService = new OllamaService(this.glyphConfig);
    this.editorUI = new EditorUIService();
    this.editorService = new EditorService(this.editorUI);
}
```

**Clean Commands:** Commands focus entirely on user intent, delegating the heavy lifting to injected services.
```typescript
// src/commands/generate-code.command.ts
export default class GenerateCode extends BaseCommand {
    constructor(
        private readonly editorService: EditorService,
        private readonly ollamaService: OllamaService,
        private readonly editorUI: EditorUIService
    ) { super(); }
    
    public action = async (): Promise<void> => {
        // ... Minimal logic utilizing injected services
    }
}
```

---

## 🚀 Getting Started

1. Set your model and API endpoint in VS Code settings (`glyph.modelName`, `glyph.endpoint`).
2. Highlight a snippet of code.
3. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **Glyph**.
4. Select `Glyph: Generate Code` or `Glyph: Generate Docs`.

## ⚠️ Disclaimer
**Glyph** is under active development and has not yet reached a stable version 1.0 release. Updates may introduce breaking changes to your configuration or workflow.

> Less is more. Happy coding!
