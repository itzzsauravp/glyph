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
| **Brainstorm** | An interactive AI chat panel for exploring ideas, debugging, and getting help — with hybrid codebase awareness. |
| **Hybrid Execution** | Automatically detects model capability: tool-capable models use native tool calls for file reading/searching; others fall back to vector RAG. |
| **Agentic Tool Calls** | 9 built-in tools (read files, search code, list structure, grep, create/edit files, run commands) with free read access and permission-gated writes. |
| **Codebase Awareness** | Toggle on "Codebase" mode for vector RAG search, or let tools handle it automatically when supported. |
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
- **Command Palette**: Run `Glyph: Model Select`.
- **Brainstorm Dropdown**: Use the model dropdown directly in the Brainstorm panel.

The model picker displays:
- **Live models** from the active provider (with real-time discovery)
- **Registered cloud models** you've set up
- **Recently used models** from your history

Switching a model updates the active provider, endpoint, and model name in one step.

### 3. Using Glyph

| Action | How |
|---|---|
| Generate Code | Highlight code → Right-click → **Glyph: Generate Code** → Enter instruction |
| Generate Docs | Highlight code → Right-click → **Glyph: Generate Docs** |
| Brainstorm | Right-click → **Glyph: Brainstorm** (or Command Palette) |

### 4. Brainstorm — Hybrid AI Chat

Brainstorm opens an interactive chat panel alongside your editor.

- **Tool-Based Reading (Recommended)**: Enable the **Tools** toggle in the toolbar. The model gets native access to list files, read code, search the codebase, and more — no vector search needed.
- **Vector RAG Fallback**: If the model doesn't support tool calls, toggle **Codebase** for vector-powered code retrieval (requires an embedding model).
- **Automatic Detection**: When you enable Tools, Glyph tests the model's capability. If supported, it auto-disables Vector RAG since tools are superior. If unsupported, it falls back to RAG.
- **Model Switching**: Use the dropdown to switch models mid-session. Tool capability is re-tested automatically.
- **Session Persistence**: Brainstorm restores automatically on VS Code reload.

#### Tool Permission Model

| Tool Category | Permission | Tools |
|---|---|---|
| **Read** (free) | No approval needed | `list_project_structure`, `read_file_content`, `read_lines`, `search_codebase`, `grep_search`, `list_workspace_files` |
| **Write** (gated) | Requires user approval | `create_file`, `edit_file`, `run_command` |

Read tools execute instantly. Write tools show an "Allow / Deny" prompt inline in the chat before execution.

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
| "API Call Failed (400)" | Your model or provider may not support the requested API format. |
| Tools toggle shows error | This model doesn't support tool calling — use the Codebase (RAG) toggle instead. |
| Tool calls ask permission for reads | Update to latest version — read tools now have unrestricted access. |

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

Glyph uses a clean, layered architecture with dependency injection and a hybrid execution model:

```text
src/
 ├── adapters/                  # Provider-specific LLM adapters
 │   ├── base-llm.adapter.ts    # Abstract base for all adapters
 │   ├── openai.adapter.ts      # OpenAI + OpenAI-compatible (Ollama, LM Studio, Groq)
 │   ├── anthropic.adapter.ts   # Anthropic Claude
 │   ├── google.adapter.ts      # Google Gemini
 │   ├── openrouter.adapter.ts  # OpenRouter
 │   └── index.ts               # Adapter factory (resolveAdapter)
 ├── commands/
 │   ├── config/                # Provider setup, model selection, key management
 │   ├── core/                  # Base command, diagnostics
 │   └── generation/            # Code gen, docs gen, brainstorm
 ├── config/
 │   └── glyph.config.ts        # Centralized settings + EventEmitter
 ├── constants/                 # Cloud provider registry, display name mapping
 ├── core/
 │   └── app.ts                 # App bootstrap and DI container
 ├── services/
 │   ├── ai/
 │   │   ├── llm.service.ts     # LLM interface (generation, embeddings, chat streaming)
 │   │   ├── llm-health.service.ts  # Health checks and preflight
 │   │   ├── tools/
 │   │   │   └── ToolRegistry.ts    # Tool definitions (read=free, write=HITL)
 │   │   ├── repo-indexer.service.ts # File parsing and indexing
 │   │   ├── vector-database.service.ts # LanceDB vector store
 │   │   └── preflight/         # Provider-specific preflight testers
 │   ├── core/                  # StatusBar, CommandManager, ModelRegistry
 │   └── editor/                # Editor service, UI service, range tracking
 ├── types/                     # TypeScript type definitions
 └── webview/
     └── brainstorm/            # Chat UI (HTML, CSS, JS)
```

### Key Design Decisions

- **Hybrid Execution Model**: Tool-capable models use native tool calls for codebase exploration. Non-tool-capable models fall back to vector RAG. The decision is automatic based on a capability test.
- **Free Read / Gated Write**: Read tools (file reading, searching, listing) execute without permission. Write tools (file creation, editing, commands) require explicit user approval via an inline UI prompt.
- **Tool Capability Caching**: The `testToolCallSupport()` result is cached per `providerType::model` to avoid redundant API calls on every interaction.
- **EventEmitter-driven config**: `GlyphConfig` fires events on every setting change. The StatusBar and Brainstorm subscribe — no polling.
- **Unified ModelRegistry**: A single service aggregates models from all sources. Every picker and dropdown queries this one source.
- **Adapter pattern**: Each LLM provider is encapsulated behind `BaseLLMAdapter`. Adding a new provider = one new file.
- **Preflight framework**: Modular `IPreflightTester` interface with local and cloud implementations.

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

---

## 📝 Changelog

### Version 0.4.0
- **[Feature] Hybrid Execution Model:** Automatic detection of tool call support. Tool-capable models use native tools; others fall back to vector RAG.
- **[Feature] Free Read Access:** Read tools (list files, read content, search, grep) execute without permission prompts.
- **[Feature] Tool Capability Caching:** `testToolCallSupport()` results cached per model to avoid redundant API calls.
- **[Feature] Hybrid Code Generation:** `Glyph: Code Generate` uses tool-based context when the model supports it, RAG otherwise.
- **[Feature] Auto-Toggle RAG:** Enabling tools auto-disables vector RAG (tools replace it). Disabling tools restores RAG availability.
- **[Fix] Permission Gate Deadlock:** Read tool calls no longer block on permission prompts, fixing the "asks permission and nothing happens" issue.
- **[Refactor] ToolRegistry:** Split into `buildReadTools()` (free) and `buildWriteTools()` (HITL), with `getReadOnlyTools()` and `getTools()` public APIs.

### Version 0.3.0
- **[Feature] Unified Model Selection:** Model picker shows live, registered, and recently-used models across all providers.
- **[Feature] Brainstorm Session Lifecycle:** Proper session restoration on VS Code restart.
- **[Feature] Codebase Awareness Toggle:** Simple toggle in Brainstorm toolbar.
- **[Feature] Preflight Diagnostics:** New `Run Diagnostics` command.
- **[Feature] Event-Driven Config:** StatusBar and Brainstorm auto-sync.
- **[Refactor] ModelRegistryService:** Centralized source of truth for all model state.

### Version 0.2.0
- **[Feature] Cloud Provider Support:** Orchestrator for Groq, OpenRouter, and Gemini.
- **[Feature] Custom API Key Setup:** `glyph.setup_custom_model` for arbitrary endpoints.
- **[Refactor] Generic Backend Support:** Decoupled from Ollama to support any OpenAI-compatible endpoint.

---

## ⚠️ Disclaimer

**Glyph** is under active development and has not yet reached a stable version 1.0 release. Updates may introduce breaking changes to your configuration or workflow.

> Less is more. Happy coding!
