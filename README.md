# Glyph 🪶

Glyph is a privacy-first AI assistant extension for Visual Studio Code. Built to be backend-agnostic, Glyph empowers you out of the box with the flexibility to choose: **process locally** for maximum privacy using any OpenAI-compatible API, or connect directly to **Cloud AI Providers** (like Groq, OpenRouter, or Gemini API) for blazing-fast generation on lightweight hardware.

Designed for learners, minimalists, and privacy-conscious developers, Glyph provides **"micro-interventions"** rather than intrusive, full-scale AI workflows. It gets out of your way, putting you—the developer—back in complete control of your codebase.

---

## ✨ Features

- **Micro-Completions:** Highlight a block of code, right-click, and let Glyph generate missing pieces or refactor it based on a simple prompt. No ghost text trying to autocomplete every keypress.
- **Auto-Documentation:** Instantly generate rich, standard docstrings for your functions and classes with a single command.
- **Flexible Backends:** 
  - **Local First:** Point Glyph to any local LLM runner (like LM Studio, vLLM, or Ollama) using the custom model setup to ensure your code never leaves your machine.
  - **Cloud Providers:** Instantly scale to Groq, OpenRouter, or Gemini if your local hardware is struggling.
- **Central Context Menu:** Manage your models seamlessly by right-clicking in the editor, clicking **Glyph**, and selecting your action.

---

## 🚀 Getting Started

### 1. Setting Up Your AI Model

You no longer need to manually modify `settings.json`. You can manage everything straight from the Editor Context Menu:

1. Right-click anywhere in your code editor.
2. Under the **Glyph** submenu, choose one of the following:

   - **🚀 Select/Swap Built-in Model:** Pin a discovered local model if configured.
   - **☁️ Cloud Provider Orchestrator:** Follow the prompt to connect to Groq, Gemini, or OpenRouter. Your API keys are stored securely using VS Code's native SecretStorage.
   - **⚙️ Setup Custom Model & API Key:** Manually specify a custom LLM provider name, the API base URL, and an optional API key (essential for pointing to any generic OpenAI-compatible local/remote servers).

3. To delete any of your stored API keys, navigate to the **Glyph** submenu and select **Manage / Delete API Keys**.

### 2. Using Glyph

Once setup is complete, highlight a snippet of code, right-click -> **Glyph**, and select:
- **Glyph: Generate Code**
- **Glyph: Generate Docs**

#### Natively Bindable Shortcuts
Because all Glyph tools are registered natively in VS Code, you can bind custom vim combinations or standard keyboard shortcuts straight to them without needing to go through the context menu.

Example `keybindings.json`:
```json
{
  "key": "ctrl+alt+g",
  "command": "glyph.code",
  "when": "editorTextFocus"
}
```

---

## 🏗️ Architecture & Philosophy

Glyph is built using a cleanly separated, class-based architecture that leverages Dependency Injection. This makes the codebase robust, scalable, and extremely welcoming for open-source contributors.

### Folder Structure
```text
src/
 ├── commands/            # Individual, localized user actions
 ├── config/              # User settings and environment configuration
 ├── core/                # Bootstrap, app lifecycle, and extension entrypoint
 └── services/            # DI-managed services
```

---

## 📝 Changelog

### Version 0.2.0 
- **[Feature] Cloud Provider Support:** Added orchestrator to securely accept Provider tokens and proxy completions via Groq, OpenRouter, and Gemini.
- **[Feature] Custom API Key Setup:** Added `glyph.setup_custom_model` allowing independent LLM URLs, model identifiers, and bearer tokens.
- **[Refactor] Generic Backend Support:** Decoupled from Ollama to strictly support any OpenAI-compatible custom endpoints effortlessly.
- **[Refactor] Editor Context Menu Architecture:** Consolidated all commands safely under the Editor Submenu while retaining raw command-binding compatibility.

---
## ⚠️ Disclaimer
**Glyph** is under active development and has not yet reached a stable version 1.0 release. Updates may introduce breaking changes to your configuration or workflow.

> Less is more. Happy coding!
