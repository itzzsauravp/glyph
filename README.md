# Glyph 🪶

**A privacy-first, backend-agnostic AI assistant for Visual Studio Code.**

Glyph empowers you with the flexibility to choose: **process locally** for maximum privacy using any OpenAI-compatible API (Ollama, LM Studio, vLLM), or connect to **Cloud AI providers** (OpenRouter, Gemini, Groq, OpenAI, Anthropic) for fast generation on lightweight hardware.

Designed for learners, minimalists, and privacy-conscious developers, Glyph provides **"micro-interventions"** — targeted code generation, documentation, and brainstorming — putting you in complete control of your codebase.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Code Generation** | Highlight code, right-click → Glyph → Generate Code. Provide an instruction and Glyph modifies only the selected block. |
| **Auto-Documentation** | Generate rich, standard docstrings for functions and classes with a single command. |
| **Brainstorm** | An interactive AI chat panel for exploring ideas, debugging, and getting help — with optional codebase awareness. |
| **Codebase Awareness** | Toggle on "Codebase" mode and Glyph will automatically retrieve relevant code context from your workspace using vector search. |
| **Multi-Provider Support** | Seamlessly switch between local (Ollama, LM Studio) and cloud (OpenRouter, Gemini, Groq, OpenAI, Anthropic) providers. |
| **Unified Model Selection** | One picker shows all models — live from your provider, registered cloud models, and recently used history. |
| **Preflight Diagnostics** | Run `Glyph: Run Diagnostics` to validate API keys, endpoint connectivity, and model availability across all providers. |
| **Secure Key Storage** | API keys are stored using VS Code's native SecretStorage — never written to disk in plain text. |

---

## 🚀 Getting Started

### 1. Setting Up Your AI Provider

#### Option A: Local Provider (Ollama / LM Studio)

1. Install [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai).
2. Pull a model (e.g. `ollama pull llama3.2`).
3. Glyph auto-detects Ollama at `http://localhost:11434` by default.
4. For embedding-powered features, also pull: `ollama pull nomic-embed-text`.

#### Option B: Cloud Provider

1. Right-click in the editor → **Glyph** → **Cloud Provider Orchestrator**.
2. Select your provider (Gemini, Groq, OpenRouter, Anthropic).
3. Enter your API key when prompted — it's stored securely.
4. Choose a model tier, and Glyph verifies the connection automatically.

#### Option C: Custom OpenAI-Compatible Endpoint

1. Right-click → **Glyph** → **Setup Custom Model & API Key**.
2. Enter a model name, base URL, and optional API key.
3. Works with any OpenAI-compatible server (vLLM, text-generation-webui, etc.).

### 2. Selecting & Switching Models

- **Status Bar**: Click the Glyph status bar item (bottom-right) to open the model picker.
- **Command Palette**: Run `Glyph: Select or Swap a model`.
- **Context Menu**: Right-click → Glyph → Select/Swap Model.

The model picker displays:
- **Live models** from the active provider (with real-time discovery)
- **Registered cloud models** you've set up
- **Recently used models** from your history

Switching a model updates the active provider, endpoint, and model name in one step.

### 3. Using Glyph

Once setup is complete:

| Action | How |
|---|---|
| Generate Code | Highlight code → Right-click → **Glyph: Generate Code** → Enter instruction |
| Generate Docs | Highlight code → Right-click → **Glyph: Generate Docs** |
| Brainstorm | Right-click → **Glyph: Brainstorm** (or Command Palette) |

### 4. Brainstorm

Brainstorm opens an interactive chat panel alongside your editor.

- **Codebase Awareness**: Toggle the **Codebase** switch in the toolbar. When active, Glyph automatically retrieves relevant code from your workspace to answer questions accurately.
- **Model Switching**: Use the dropdown in the toolbar to switch models mid-session. Changes also sync from the status bar and command palette.
- **Session Persistence**: If you leave Brainstorm open and reload VS Code, it restores automatically. If you close it, it stays closed.

---

## ⚙️ Configuration

All settings are under `glyph.*` in VS Code Settings:

| Setting | Default | Description |
|---|---|---|
| `glyph.modelName` | `""` | Active model identifier (e.g. `llama3.2`, `gpt-4o`) |
| `glyph.embeddingModelName` | `""` | Embedding model (e.g. `nomic-embed-text`, `text-embedding-3-small`) |
| `glyph.base_url` | `http://localhost:11434` | Base URL for your AI provider |
| `glyph.providerType` | `Ollama` | Active provider: `Ollama`, `LM Studio`, `OpenRouter`, `OpenAI`, `Anthropic`, `Google` |
| `glyph.autoSave` | `false` | Auto-save file after code/docs generation |

### Managing API Keys

- **Add keys**: Via Cloud Provider Orchestrator or Custom Model Setup.
- **Delete keys**: Right-click → Glyph → **Manage / Delete API Keys**.
- Keys are scoped per provider (stored as `glyph.apiKey.<provider>`).

---

## 🔍 Diagnostics & Troubleshooting

### Run Diagnostics

Run `Glyph: Run Diagnostics` from the Command Palette. This validates:

- ✓ API key presence for each configured cloud provider
- ✓ Endpoint reachability and authentication
- ✓ Model availability
- ✓ Embedding model availability (local providers)

Results appear in the **Glyph Diagnostics** output channel.

### Common Issues

| Issue | Solution |
|---|---|
| "Preflight failed" | Run Diagnostics. Check if your provider is running and API key is valid. |
| "Connection Refused" | Ensure Ollama/LM Studio is running, or check your internet for cloud providers. |
| "Model Not Found" | Verify the model name matches what's available on your provider. |
| "API Call Failed (400)" | Your model or provider may not support the requested API format. Check logs. |
| Brainstorm shows old model | Model changes sync automatically. If stale, reopen Brainstorm. |

### Visual Log Viewer

Run `Glyph: Visual Log Viewer` for detailed internal logs with timestamps and severity levels.

---

## ⌨️ Keyboard Shortcuts

All Glyph commands are natively bindable. Example `keybindings.json`:

```json
[
  { "key": "ctrl+alt+g", "command": "glyph.code", "when": "editorTextFocus" },
  { "key": "ctrl+alt+d", "command": "glyph.docs", "when": "editorTextFocus" },
  { "key": "ctrl+alt+b", "command": "glyph.brainstorm" }
]
```

---

## 🏗️ Architecture

Glyph uses a clean, layered architecture with dependency injection:

```text
src/
 ├── adapters/         # Provider-specific LLM adapters (OpenAI, Anthropic, Google, etc.)
 ├── commands/         # VS Code command implementations
 │   ├── config/       # Provider setup, model selection, key management
 │   ├── core/         # Base command, diagnostics, logging
 │   └── generation/   # Code gen, docs gen, brainstorm
 ├── config/           # GlyphConfig (centralized settings + EventEmitter)
 ├── constants/        # Cloud provider registry
 ├── core/             # App bootstrap and lifecycle
 ├── resources/        # Webview HTML templates
 ├── services/
 │   ├── ai/           # LLMService, LLMHealth, VectorDB, Repo Indexer
 │   │   └── preflight/ # Provider-specific preflight testers
 │   ├── core/         # StatusBar, CommandManager, ModelRegistry, Logging
 │   └── editor/       # Editor service, UI service, range tracking
 ├── types/            # TypeScript type definitions
 └── webviews/         # Webview providers (log viewer)
```

### Key Design Decisions

- **EventEmitter-driven config**: `GlyphConfig` fires events on every setting change. The StatusBar and Brainstorm subscribe — no polling.
- **Unified ModelRegistry**: A single service aggregates models from all sources. Every picker and dropdown queries this one source.
- **Adapter pattern**: Each LLM provider is encapsulated behind `BaseLLMAdapter`. Adding a new provider = one new file.
- **Preflight framework**: Modular `IPreflightTester` interface with local and cloud implementations. Easy to extend per-provider.

---

## 📝 Commands Reference

| Command | ID | Description |
|---|---|---|
| Generate Code | `glyph.code` | Modify selected code with AI instruction |
| Generate Docs | `glyph.docs` | Generate docstrings for selected code |
| Brainstorm | `glyph.brainstorm` | Open interactive AI chat panel |
| Select/Swap Model | `glyph.model_select` | Unified model picker (all providers) |
| Cloud Provider | `glyph.cloud_provider_orchestrator` | Setup a cloud AI provider |
| Custom Model | `glyph.setup_custom_model` | Configure a custom endpoint |
| Manage API Keys | `glyph.manage_api_keys` | View / delete stored API keys |
| Run Diagnostics | `glyph.run_diagnostics` | Validate all provider connections |
| Reload Config | `glyph.reload` | Force reload Glyph configuration |
| Visual Log Viewer | `glyph.show_logs` | Open the internal log viewer |

---

## 📝 Changelog

### Version 0.3.0
- **[Feature] Unified Model Selection:** Model picker now shows live, registered, and recently-used models across all providers.
- **[Feature] Brainstorm Session Lifecycle:** Proper session restoration on VS Code restart. Explicit close prevents orphaned panels.
- **[Feature] Codebase Awareness Toggle:** Simple toggle in Brainstorm toolbar replaces the old Buffer/Codebase buttons.
- **[Feature] Preflight Diagnostics:** New `Run Diagnostics` command validates all configured providers.
- **[Feature] Event-Driven Config:** StatusBar and Brainstorm auto-sync when model/provider changes.
- **[Refactor] ModelRegistryService:** Centralized source of truth for all model state.
- **[Refactor] Preflight Framework:** Modular testers per provider type.

### Version 0.2.0
- **[Feature] Cloud Provider Support:** Orchestrator for Groq, OpenRouter, and Gemini.
- **[Feature] Custom API Key Setup:** `glyph.setup_custom_model` for arbitrary endpoints.
- **[Refactor] Generic Backend Support:** Decoupled from Ollama to support any OpenAI-compatible endpoint.
- **[Refactor] Editor Context Menu:** Consolidated under the Glyph submenu.

---

## ⚠️ Disclaimer

**Glyph** is under active development and has not yet reached a stable version 1.0 release. Updates may introduce breaking changes to your configuration or workflow.

> Less is more. Happy coding!
