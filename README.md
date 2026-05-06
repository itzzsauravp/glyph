# Glyph — Micro AI Helper

> A privacy-first, backend-agnostic AI assistant for code generation, documentation, and brainstorming in VS Code.

## Architecture

Glyph uses a **thin client + heavy server** architecture:

```
┌─────────────────────────────────┐         ┌──────────────────────────┐
│    VS Code Extension (Client)   │         │   glyph-server (Docker)  │
│                                 │         │                          │
│  ServerClient ─────────REST────────────→  │  Express REST API        │
│  (HTTP + Socket.IO)                       │  Socket.IO               │
│                ─────Socket.IO──────────→  │  LLM Service (AI SDK)    │
│                                 │         │  LanceDB (Vector Index)  │
│  Background Indexer             │         │  Tool Registry           │
│  Brainstorm Chat UI             │         │  WorkspaceManager        │
│  Status Bar                     │         │                          │
└─────────────────────────────────┘         └──────────────────────────┘
```

The extension is a **lightweight client** (< 3 MB) that handles:
- VS Code UI (commands, webviews, status bar)
- Symbol extraction via VS Code's language services
- Configuration management (settings + secret storage for API keys)

The server handles all **compute-intensive operations**:
- LLM inference via multiple providers (Ollama, LM Studio, OpenAI, Anthropic, Google, OpenRouter)
- Vector embeddings + LanceDB indexing
- Tool execution (file read/write, terminal commands)
- RAG-based codebase context retrieval

## Prerequisites

- **VS Code** ≥ 1.110.0
- **Docker** (recommended) or **Node.js** ≥ 22 for the server

## Quick Start

### 1. Start the Server

```bash
# Using Docker (recommended):
docker compose up -d

# Or manually:
cd glyph-server
npm install && npm run build && npm start
```

### 2. Install the Extension

Install from the VS Code Marketplace or build from source:

```bash
npm install
npm run compile
npx vsce package
# Install the .vsix file in VS Code
```

### 3. Configure

The extension auto-activates on VS Code startup. On first launch:

1. The status bar shows connection status
2. If the server is running, you're ready to go
3. If not, click the status bar → "Start Docker"

## Features

### 🤖 Code Generation
Select code → Right-click → **Glyph: Code Generate** → Enter prompt

### 📝 Documentation
Select function → Right-click → **Glyph: Docs Generate**

### 💬 Brainstorm Chat
Open command palette → **Glyph: Brainstorm**

Features:
- Real-time streaming via Socket.IO
- Tool use (file read/write, terminal commands)
- HITL permission flow for write operations
- Structure-aware context
- Chat memory with configurable limits

### 🔍 Background Indexing
On activation, the extension:
1. Scans all workspace source files
2. Extracts symbols using VS Code's language services
3. Sends them to the server for embedding + vector indexing
4. Watches for file changes and re-indexes incrementally

## Settings

| Setting                            | Default                    | Description                                                          |
|------------------------------------|----------------------------|----------------------------------------------------------------------|
| `glyph.serverUrl`                  | `http://localhost:9741`    | URL of the Glyph server                                             |
| `glyph.serverAuthToken`            | `""`                       | Bearer token for remote servers                                     |
| `glyph.modelName`                  | `""`                       | Active model identifier                                             |
| `glyph.providerType`               | `"Ollama"`                 | LLM provider (Ollama, LM Studio, OpenAI, etc.)                     |
| `glyph.base_url`                   | `http://localhost:11434`   | Provider API base URL                                               |
| `glyph.embeddingModelName`         | `""`                       | Model for vector embeddings                                         |
| `glyph.chat.memoryLimit`           | `15`                       | Max messages in chat history                                        |
| `glyph.chat.structureAware`        | `false`                    | Include directory tree in chat context                              |
| `glyph.chat.codebaseAware`         | `false`                    | Enable RAG context retrieval                                        |
| `glyph.chat.toolsEnabled`          | `false`                    | Allow AI to read/write files                                        |
| `glyph.reasoning.budgetTokens`     | `10000`                    | Token budget for reasoning models                                   |
| `glyph.agent.requireToolPermission`| `true`                     | Require confirmation for write tools                                |
| `glyph.autoStartServer`            | `false`                    | Auto-start Docker on activation                                     |
| `glyph.autoSave`                   | `false`                    | Auto-save after code generation                                     |

## Commands

| Command                              | Description                              |
|---------------------------------------|------------------------------------------|
| `Glyph: Code Generate`               | Generate or modify code                  |
| `Glyph: Docs Generate`               | Generate documentation comments          |
| `Glyph: Brainstorm`                   | Open interactive chat panel              |
| `Glyph: Model Select`                | Switch active model                      |
| `Glyph: Cloud Provider Orchestrator`  | Configure cloud AI provider              |
| `Glyph: Setup Custom Model & API Key` | Configure custom model endpoint          |
| `Glyph: Manage / Delete API Keys`    | Manage stored API keys                   |
| `Glyph: Run Diagnostics`             | Check server + provider health           |
| `Glyph: Start Server (Docker)`       | Start glyph-server via Docker            |
| `Glyph: Reload Config`               | Reload configuration                     |

## Supported Providers

| Provider     | Type   | Default Endpoint                |
|-------------|--------|----------------------------------|
| Ollama      | Local  | `http://localhost:11434`         |
| LM Studio   | Local  | `http://localhost:1234`          |
| OpenAI      | Cloud  | `https://api.openai.com`        |
| Anthropic   | Cloud  | `https://api.anthropic.com`     |
| Google      | Cloud  | `https://generativelanguage.googleapis.com` |
| OpenRouter  | Cloud  | `https://openrouter.ai`         |

## Development

```bash
# Install dependencies
npm install

# Build
npm run compile

# Watch mode
npm run watch

# Package VSIX
npm run release

# Lint
npm run lint
```

## License

MIT
