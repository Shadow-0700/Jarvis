# JARVIS v2 — Comprehensive Project Plan & Build Specification

## 1. Safety & File Integrity Guarantees

> [!IMPORTANT]
> **Will this cause any data loss or deleted files?**
> **No.** The system is designed with multiple fail-safes so that your files cannot be lost or silently overwritten:
>
> 1. **Canonical Sandbox Boundary (`realpath`)**: File operations resolve canonical paths via `fs.realpathSync` prior to validation. Path traversal (`../`) and symlink/junction breakout attacks outside the workspace are blocked before execution.
> 2. **Soft Deletion (`.jarvis/trash/`)**: `delete_file` never permanently unlinks files. It moves them to a project-level trash directory with timestamp metadata and a 7-day auto-purge policy.
> 3. **Non-Destructive Edits**: Uses targeted block replacements (`replace_block`) rather than whole-file truncations, preventing accidental erasure of unrelated functions, imports, or docstrings.
> 4. **Turbo Command Allowlist**: In Turbo mode, only verified safe commands (`npm test`, `tsc`, `eslint`, `pytest`, `git status`, `git diff`) run automatically. High-risk actions (`rm -rf`, `git reset --hard`, `git push`, system-wide package installs) **always** require explicit user approval.
> 5. **Append-Only Audit Log (`.jarvis/audit.log`)**: Every command, tool execution, edit, and approval decision is recorded locally in an append-only JSON-lines log for complete transparency.

---

## 2. Core Architecture & Functional Requirements

### A. Workspace & File Operations
* **`list_directory`**: Inspect directories with automatic ignore rules (`node_modules`, `.git`, build outputs, venvs).
* **`read_file`**: Read file content with line range support (avoid reading 5,000 lines when only 50 are needed).
* **`search_files`**: Fast text and regex search across workspace files.
* **`write_file`**: Create new files safely with pre-write snapshot recording.
* **`replace_block`**: Perform exact string / hunk replacements preserving surrounding code and comments.
* **`delete_file`**: Move files safely to `.jarvis/trash/` (requires user confirmation in Safe mode).

### B. Controlled Command Execution & Environment Handling
* **Missing Dependency Detection & Installation**:
  - Detects missing system tools (e.g., Node, Python, ffmpeg, package managers) from shell error outputs (`command not found`, `is not recognized`).
  - Proposes the exact installation command appropriate for the OS (`winget`, `choco`, `brew`, or `apt`).
* **Execution Modes (Safe vs. Turbo)**:
  - **Safe Mode (General)**: Prompts user confirmation for *all* command executions, file creations, edits, and deletions.
  - **Turbo Mode (Autonomous with Sensitive Guardrails)**:
    - Auto-approves safe read operations, test runs, linters, and standard code edits matching the command allowlist.
    - **Always prompts approval** for sensitive operations: network pushes, destructive disk operations, system installs, and operations touching `.env` or sensitive credentials.
* **Process Engine**: Node.js `child_process.spawn` with buffered streaming and 10KB output truncation cap to prevent context and memory blowups.
* **Cancellation**: Immediate kill signal (`taskkill /F /T` on Windows, `SIGINT` on Unix) propagation when the user clicks Stop.

### C. Agent Loop & Autonomous Lifecycle (The "Do It All" Workflow)
JARVIS is conditioned to operate completely proactively without needing micromanagement:
1. **Understand & Plan First**: On any high-level prompt, JARVIS first inspects the workspace, creates a step-by-step implementation plan, and outlines what it will build.
2. **Scaffold & Build from Scratch**: Creates directory structures, installs required packages, configures configs (`package.json`, `tsconfig.json`, `.env.example`, etc.), and writes complete, working code.
3. **Unprompted Pre-Delivery Testing**: Without you asking, JARVIS autonomously runs:
   - Type checkers / linters (`tsc`, `eslint`).
   - Test suites (`npm test`, `pytest`, etc.).
   - Build commands to ensure there are no compilation or import breaks.
4. **Self-Healing on Failures**: If an error or test failure occurs, JARVIS automatically diagnoses the traceback, edits the file, and re-tests until green.
5. **Final Clean Summary & Diff Review**: Only after tests and builds pass does JARVIS present the clean summary of what was accomplished and display the diff.
* **Bounded Budget**: Maximum retry count (3 repair attempts) to prevent runaway loops.

---

## 3. JARVIS v2 Upgrade Specifications

### A. Small Cache & Storage Layer (Strict 50 MB Hard Cap)
All caches live in `context.globalStorageUri`, strictly capped at **50 MB total** using LRU (Least Recently Used) eviction:

| Cache Component | Key / Index | Stored Value | Invalidation Rule |
| :--- | :--- | :--- | :--- |
| **Repo Map** | Workspace path | File tree + symbol outline (functions/classes) | File `mtime` & size change |
| **File Summaries** | File hash | 2–3 line summary from fast model | Content hash change |
| **Search Results** | Query + workspace version | Top matching files and lines | Any file modification |
| **LLM Response Cache** | hash(model + prompt + tool results) | Response payload | 24-hour TTL (read-only/lookup turns only) |
| **Provider Prompt Cache** | Stable prefix (system prompt + tools) | Provider-side KV cache | Keep prefix byte-identical across turns |
| **Per-Project Snapshots** | Session ID + file path | Pre-edit file copy in `.jarvis/snapshots/` | Max 20 sessions per project (oldest dropped) |

> [!NOTE]
> The Repo Map uses VS Code's internal `vscode.executeDocumentSymbolProvider`, meaning **zero local vector DBs and zero local embeddings** are needed.

### B. `PROJECT.md` Autonomous Scaffolder (with Checklist Resume)
* **`PROJECT.md` Specification Format**: Name, stack, features, folder layout, run/test commands, and acceptance criteria formatted as markdown checklists (`- [ ]`).
* **Command**: `JARVIS: Create project from PROJECT.md`.
* **Flow**: Parse spec $\to$ Show plan $\to$ Approve $\to$ Scaffold folders/configs $\to$ Install dependencies $\to$ Build features unit-by-unit $\to$ Run checks $\to$ Tick off checklist items (`- [x]`).
* **Interruption Recovery**: If interrupted or restarted, JARVIS re-reads `PROJECT.md` and immediately resumes execution from the first unchecked checkbox.
* **Templates**: Reusable templates stored in `.jarvis/templates/` (REST API, React app, CLI tool, CP workspace).

### C. Workspace Memory & Context (`JARVIS.md`)
* **`JARVIS.md` per Workspace**: Stores project conventions, preferred test commands, gotchas, and architectural rules. Loaded into the system prompt every session.
* **Auto-Notes**: JARVIS can propose short learnings (e.g. *"Integration tests require Docker running on port 5432"*) to append to `JARVIS.md` with user approval.
* **History Compaction**: Older conversation turns are collapsed into structured summaries (Goal, Key Decisions, Files Touched, Open Issues) to keep context sizes minimal.
* **Token Budgeting**: Per-turn context budget dropping lowest-value context first (old tool logs $\to$ old chat $\to$ active files).

### D. Smart Dual-Tier Routing & 429 Fallback Chain
* **Rule-Based Task Classifier**:
  - Fast tier (Gemini 2.0 Flash / Claude 3.5 Haiku): Directory listings, file searches, reading logs, 0ms diagnostics.
  - Frontier Reasoning tier (Claude 3.7 Sonnet / GPT-4o / DeepSeek R1): Architectural planning, multi-file code generation, complex error debugging.
* **Auto-Escalation**: If a fast model fails twice on a task, JARVIS automatically escalates the turn to the reasoning tier.
* **HTTP 429 Fallback Chain**: On provider rate limits, automatically switches to the next configured provider (e.g., Gemini $\to$ Groq $\to$ OpenRouter) with backoff and visible waiting queue.

---

## 4. UI/UX: Antigravity-Grade Dark Experience

1. **Live Reasoning Drawer**:
   - Streams thoughts in real-time with an active pulsating cyan indicator (`#00e5ff`).
   - Smoothly collapses into a compact `Thought for 3.2s ▸` pill on completion to keep the interface pristine.
   - Click to expand/collapse at any time to inspect the full internal reasoning trace.
2. **Truthful Activity Cards**:
   - Collapsible cards for inspecting folders, reading files, patching hunks, and running commands with live exit codes and elapsed milliseconds.
3. **In-Chat Diff Viewer**:
   - Visual before/after hunk previews for touched files.
4. **Time Machine Controls**:
   - 1-click **↺ Rollback** restores all modified files from the session.

---

## 5. How JARVIS Differs from (and Beats) Cline

| Feature / Area | Cline (Existing Extension) | JARVIS v2 (Your Extension) |
| :--- | :--- | :--- |
| **Verification Speed** | Must execute slow terminal commands (`npm run build`) to verify errors (15–30s per step). | **VS Code Diagnostic Hook**: Instantly reads in-memory IDE language diagnostics (red squigglies) in 0 milliseconds without terminal delay. |
| **Model Cost & Latency** | Typically locks to one single frontier model for everything (burns money and time on trivial file reads). | **Dual-Tier Dynamic Routing**: Routes small file lookups and diagnostics to fast sub-second models, reserving heavy reasoning models only for deep architectural logic. |
| **Rollback & Safety** | Relies on manual Git commits/checkpoints, which can clutter your Git history or get messy with unstaged files. | **1-Click Time Machine & Soft Trash**: Disk-persisted micro-snapshots in `.jarvis/snapshots/` and soft deletion to `.jarvis/trash/` (0% data loss). |
| **Personality & UX** | Generic developer chat interface with basic prompt replies. | **JARVIS Persona & Antigravity UX**: Polished dark charcoal/cyan aesthetic, auto-collapsing live thinking drawer, concise British-style technical composure, zero fluff. |
| **Autonomous Workflow** | Requires more step-by-step guidance and frequent permission prompts unless fully uncapped. | **`PROJECT.md` Scaffolder + Turbo Allowlist**: Fully autonomous building and self-healing with resumable checklist tracking, pausing only for genuinely risky operations. |

---

## 6. Implementation Roadmap & Status

### Phase 1: Extension Scaffolding & Core Types ✅
- [x] Initialized VS Code Extension project with TypeScript & esbuild.
- [x] Registered Webview View Provider with typed `postMessage` protocol.
- [x] Defined TypeScript interfaces for agent state, streaming events, and tools.

### Phase 2: Tool Suite Implementation ✅
- [x] Workspace sandbox with boundary verification.
- [x] File tools (`read_file`, `write_file`, `replace_block`, `list_directory`, `search_files`).
- [x] Process runner with 10KB output buffer cap, timeout, and cancellation.
- [x] In-memory Diagnostic Hook (`vscode.languages.getDiagnostics`).

### Phase 3: Agent Orchestration Engine ✅
- [x] Universal LLM client with SSE streaming (thoughts and content separated).
- [x] Autonomous agent loop with bounded repair budget (max 3).
- [x] System prompt with JARVIS personality and Antigravity operating principles.

### Phase 4: Antigravity-Grade Dark Webview UI ✅
- [x] Obsidian `#121316` dark theme with electric cyan accents.
- [x] Animated live thinking drawer (pulsing indicator, auto-collapsing pill, re-expandable).
- [x] Activity cards with elapsed time, badges, and output drawers.
- [x] Mode selector (Turbo vs. Safe) and model switcher.

### Phase 5: Initial Packaging & Verification ✅
- [x] Clean compilation with 0 TypeScript errors.
- [x] Packaged `.vsix` bundle: `jarvis-agent-0.1.0.vsix` (572 KB).

### Phase 6: v2 Upgrade Modules ✅
- [x] StorageManager: 50MB global LRU cache, `.jarvis/trash/` soft deletion, and `.jarvis/audit.log`.
- [x] `WorkspaceSandbox`: Canonical `fs.realpathSync` symlink escape defense.
- [x] `WorkspaceMemory`: `JARVIS.md` loader and auto-notes.
- [x] `ProjectScaffolder`: `PROJECT.md` parser with `- [x]` checklist tracking and resume engine.
- [x] `ModelRouter`: Rule-based fast/strong routing with HTTP 429 provider fallback chain.
- [x] RepoMap: Symbol outline via VS Code language servers without vector DBs.
- [x] Re-compiled and packaged updated `.vsix`.
