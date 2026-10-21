# JARVIS v2 — Autonomous Agentic Coding Assistant for VS Code

An Antigravity-inspired agentic software engineering assistant built directly into VS Code. JARVIS operates as an autonomous pair programmer with the personality of Tony Stark's JARVIS: calm, composed, British-style precision, subtly witty, and quietly confident.

---

## ⚡ Core Highlights & Differentiators

### 1. Antigravity Live Reasoning & Dark Obsidian UI
* **Real-Time Thinking Stream**: Live reasoning tokens stream with a pulsating cyan indicator.
* **Auto-Collapsing Accordion**: Once reasoning finishes, it smoothly fades into an understated `Thought for 3.2s ▸` pill to keep your view uncluttered.
* **Always Inspectable**: Click the thought pill at any time to re-expand and inspect the full chain of thought.
* **Dark Obsidian Aesthetic**: Polished `#121316` charcoal canvas, electric `#00e5ff` cyan accents, collapsible activity cards, and in-chat diff views.

### 2. Autonomous "Do-It-All" Loop with 0ms Verification
* **In-Memory Diagnostic Hook**: Connects directly to `vscode.languages.getDiagnostics()` to catch syntax, type-checker, and linter errors directly from IDE memory in 0ms (no slow 30-second terminal builds needed).
* **Autonomous Self-Healing**: If a diagnostic error or test failure occurs, JARVIS diagnoses the traceback, applies targeted code patches, and re-tests on its own (bounded to 3 repair attempts).
* **Verification Ladder**: Automatically executes: Diagnostics Hook $\to$ Linter $\to$ Tests $\to$ Build.

### 3. `PROJECT.md` Autonomous Scaffolder (with Checklist Resume)
* Create entire projects from a structured `PROJECT.md` specification (stack, folder layout, features, acceptance criteria).
* **Deterministic Tracking**: Checks off checklist items (`- [x]`) in your markdown file as each unit passes verification.
* **Interruption Recovery**: If interrupted or restarted, JARVIS re-reads `PROJECT.md` and seamlessly resumes from the first unchecked item.

### 4. Workspace Memory (`JARVIS.md`)
* Place a `JARVIS.md` file in your workspace root to define project-specific conventions, preferred test commands (e.g. `pytest -q`), or architectural constraints.
* Loaded into the agent context on every session.
* Supports **Auto-Notes**: JARVIS proposes short learnings to append to your workspace rules with your approval.

### 5. Smart Model Routing & 429 Fallback Chain
* **Rule-Based Dual-Tier Routing**: Fast sub-second models (Gemini 2.0 Flash / Haiku) handle discovery, file reads, and diagnostics; frontier reasoning models (Claude 3.7 Sonnet / GPT-4o / DeepSeek R1) trigger for architecture and complex debugging.
* **Auto-Escalation**: If a fast model fails twice, it automatically escalates to the reasoning tier.
* **HTTP 429 Rate-Limit Fallback**: Seamlessly switches providers on rate limits (Gemini $\to$ Groq $\to$ OpenRouter) with backoff and visible queue status.

### 6. Strict Disk & Memory Efficiency (Zero Disk Bloat)
* **Global Cache Limit**: Hard-capped at **50 MB total** in `context.globalStorageUri` with automatic **LRU (Least Recently Used)** pruning. Even across 50+ projects, your disk never fills up.
* **Per-Project Snapshots**: Stored in `.jarvis/snapshots/`, automatically capped at **20 sessions max** (session 21 purges session 1).
* **Soft Trash (`.jarvis/trash/`)**: Deleted files are moved to project trash instead of being permanently unlinked, with a 7-day auto-purge.
* **Append-Only Audit Log**: `.jarvis/audit.log` records every tool execution, path, and approval for full transparency.

### 7. Hardened Safety & Sandbox Protection
* **Symlink Escape Defense (`realpath`)**: Validates real canonical paths on disk before reading or writing, preventing path-traversal and symlink/junction breakout attacks.
* **Turbo Command Allowlist**: Safe read operations and test commands (`npm test`, `tsc`, `eslint`, `pytest`, `git status`) run autonomously; destructive commands (`rm`, `git reset`, pushes, system installs) always pause for your confirmation.
* **Sensitive File Defense**: `.env`, credentials, and private keys (`.pem`, `.key`, `id_rsa`) are guarded against accidental context exposure.

### 8. 1-Click Time Machine Rollback
* Automatically records snapshots of all touched files before making any edits.
* Click **↺ Rollback** to undo an entire session's changes instantly without altering git branches or stashes.

---

## 🛠 Project Structure

```
jarvis/
├── src/
│   ├── agent/
│   │   ├── AgentLoop.ts          # Autonomous tool-calling loop & repair budget
│   │   ├── LlmClient.ts          # Multi-provider streaming client (SSE)
│   │   ├── ModelRouter.ts        # Fast/Reasoning tiers & 429 fallback chain
│   │   └── PromptBuilder.ts      # JARVIS persona & Antigravity principles
│   ├── cache/
│   │   └── StorageManager.ts     # 50MB global LRU cache, audit log, & trash
│   ├── memory/
│   │   └── WorkspaceMemory.ts    # JARVIS.md loader & auto-notes manager
│   ├── scaffolder/
│   │   └── ProjectScaffolder.ts  # PROJECT.md spec parser & checklist engine
│   ├── tools/
│   │   ├── DiagnosticWatchdog.ts # 0ms in-memory IDE diagnostics hook
│   │   ├── FileTools.ts          # Safe file ops with targeted replace_block
│   │   ├── ProcessRunner.ts      # Spawn runner with 10KB cap & cancel signals
│   │   ├── RepoMap.ts            # Symbol outline via VS Code language servers
│   │   ├── TimeMachine.ts        # Disk-persisted snapshots & 1-click restore
│   │   ├── ToolRegistry.ts       # Unified function calling schema definitions
│   │   └── WorkspaceSandbox.ts   # Canonical realpath sandbox boundaries
│   ├── providers/
│   │   └── JarvisWebviewProvider.ts # Sidebar view provider & postMessage bridge
│   ├── types/                    # Strict TypeScript interfaces
│   ├── webview/                  # React UI (Obsidian Antigravity aesthetic)
│   │   ├── App.tsx               # Main chat feed, thinking drawer, diff cards
│   │   ├── index.tsx             # Entrypoint
│   │   └── styles.css            # Dark theme styles
│   └── extension.ts              # Extension activation & commands
├── media/
│   └── icon.svg                  # Extension icon
├── package.json                  # VS Code manifest & build scripts
└── tsconfig.json                 # TypeScript compiler configuration
```

---

## 🚀 Installation & Getting Started

### Method 1: Install Pre-Built `.vsix`
1. Open VS Code.
2. Open the Extensions pane (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3. Click the `...` menu (top right of Extensions view) $\to$ **Install from VSIX...**.
4. Select `jarvis-agent-0.1.0.vsix` located in the root of this repository.
5. Click the **JARVIS** icon in the Activity Bar on the left.
6. Click `⚙ Set Key` to save your OpenRouter, Gemini, or Anthropic API key (stored securely in VS Code's encrypted `SecretStorage`).

### Method 2: Development / Build from Source
```bash
# Clone the repository
git clone https://github.com/your-username/jarvis.git
cd jarvis

# Install dependencies
npm install

# Build extension and webview
npm run build

# Run in VS Code Extension Development Host
# Press F5 inside VS Code
```

---

## 📋 Available Commands & Shortcuts

| Command / Action | Description |
|---|---|
| `JARVIS: Open Assistant` | Focuses the JARVIS sidebar assistant view. |
| `JARVIS: New Session` | Resets current conversation and file snapshots. |
| `JARVIS: Create Project from PROJECT.md` | Parses spec and autonomously scaffolds project step-by-step. |
| `↺ Rollback` | Restores all files modified in the active session to their original state. |
| `TURBO / SAFE Mode` | Toggle between autonomous self-healing and manual step-by-step confirmation. |

---

## 🔒 Safety & Resource Guarantees

* **Disk Usage**: Hard ceiling of 50 MB for global caches; maximum 20 snapshot sessions per project.
* **RAM Consumption**: 30–60 MB typical extension host memory footprint.
* **CPU Load**: 0% idle; sub-millisecond local routing rules.
* **Data Loss Prevention**: All file deletes are soft-moved to `.jarvis/trash/`; symlink breakout is blocked via `realpath`.

---

## 📄 License

MIT License. Designed and engineered for high-performance agentic pair programming.
