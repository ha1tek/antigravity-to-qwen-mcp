# 🧠 Antigravity to Qwen MCP (`mcp_qwen`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-v1.1%20(Attachments%20%26%20Vision%20Engine)-blue.svg)](https://github.com/ha1tek/antigravity-to-qwen-mcp)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP%20Protocol-2024--11--05-purple.svg)](https://modelcontextprotocol.io/)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078D6.svg)](https://www.microsoft.com/windows)

[ 🇷🇺 [Русская версия (Russian)](README.md) | 🇬🇧 [English Version](README.en.md) ]

> **Autonomous Model Context Protocol (MCP) Server for dual-model software development orchestration: Gemini in Google Antigravity (Orchestrator) + Qwen 3.8 Max (Executive Subagent). Out of the box, it operates locally via the Qwen Studio desktop application (leveraging Chrome DevTools Protocol / CDP), and its open-source codebase can be readily adapted for any other browser-based AI chat or direct API.**
>
> **Release: `v1.1` (Attachments & Vision Engine: up to 10 files — 4 project files + 1 prompt txt + 5 photos/screenshots)**

---

## 🚀 What's New in v1.1 (Attachments & Vision Engine)

- 📎 **Up to 10 Attachments Support in Qwen Studio:**
  - **Up to 5 Documents (`type: ["document"]`):** up to 4 project code files attached as documents + 1 `task_prompt.txt` file (packaging full prompt directives, directory tree, and full code of all remaining project files from 5 to N).
  - **Up to 5 Images (`type: ["vision"]`):** automatic scanning and attachment of UI references, mockups, screenshots (`references_photos/`, `screenshots/`, `assets/`, `mockups/`) or explicit passing via `images: ["path/to/mockup.png"]`.
- ⚡ **131,072 Characters Limit Completely Solved:** no textarea overflow errors — large prompts and remaining code are encapsulated into `task_prompt.txt`. With its 1,000,000+ token context window, Qwen 3.8 Max reads the entire codebase in a single request.
- 🎨 **Dual-Channel React Fiber Uploader:** native emulation of document and image uploads without browser page reload.
- 🎯 **Targeted Edits with Images:** support for passing targeted files (`target_files`) alongside UI design images (`images`).
- 🛠 **New Tool `mcp_qwen_build_project_context`:** inspect directory trees and pre-allocate attachments before dispatching tasks.

---

## 📑 Table of Contents

1. [Overview & Orchestration Architecture](#-overview--orchestration-architecture)
2. [Strict Orchestration Protocol](#-strict-orchestration-protocol)
3. [Under the Hood: CDP Automation Engine](#-under-the-hood-cdp-automation-engine)
4. [Available MCP Tools](#-available-mcp-tools)
5. [Installation & Single-Click Quick Start](#-installation--single-click-quick-start)
6. [Step-by-Step Usage Scenarios](#-step-by-step-usage-scenarios)
7. [Adapting the Code to ANY Other AI Chat](#-adapting-the-code-to-any-other-ai-chat)
   - [Web AI Chats in Chrome (ChatGPT, Claude, DeepSeek)](#1-adapting-for-web-ai-chats-in-google-chrome)
   - [Chrome DevTools Browser / Headless Mode](#2-adapting-for-chrome-devtools-browser--headless-mode)
   - [Local WebUIs (Ollama, LM Studio)](#3-adapting-for-local-webuis-ollama-lm-studio)
8. [Configuration (`config.json`)](#-configuration-configjson)
9. [Project File Structure](#-project-file-structure)
10. [Automated Testing](#-automated-testing)
11. [License](#-license)

---

## 🌟 Overview & Orchestration Architecture

**Antigravity to Qwen MCP** implements a dual-model software development workflow (**Orchestrator-Worker Pattern**):

- **Gemini in Google Antigravity (100% Orchestrator):** Plans high-level architecture, gathers requirements, forwards original user prompts, context files, and skill instructions without any alteration. Polls task progress using 60-second timers, extracts and writes generated project files verbatim (1:1), and submits assembled code for final verification.
- **Qwen 3.8 Max in Qwen Studio Desktop (Executive Subagent):** Generates full project directory trees, produces comprehensive file implementations inside `### FILE: path/to/file` blocks, handles chunked generation for large files (>1000 lines) with `### STATUS: NEED_CONTINUATION`, and performs Step 6 project verification.

```
┌─────────────────────────────────────────────────────────────┐
│                 Google Antigravity (Gemini)                 │
│                      [100% ORCHESTRATOR]                    │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON-RPC (stdio)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    mcp_qwen (MCP Server)                    │
│  ┌───────────────────────────┴───────────────────────────┐  │
│  │                     TaskManager                       │  │
│  │   • Prompt Builder          • Chunking / Continuation │  │
│  │   • Parser (Tree & Files)   • Verbatim File Writer    │  │
│  └───────────────────────────┬───────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │ Chrome DevTools Protocol (ws://localhost:9222)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  Qwen Studio Desktop (Electron)             │
│                     [QWEN 3.8 MAX SUBAGENT]                 │
│   • Interactive GUI Window on User's Active Desktop         │
│   • Monaco Code Editor (untruncated raw code extraction)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📜 Strict Orchestration Protocol

When executing tasks via `mcp_qwen`, Gemini adheres to strict rules built directly into the MCP specification:

1. **Strictly 100% Orchestrator:** Gemini does not write code directly bypassing the subagent; all implementation is delegated to Qwen.
2. **Zero Prompt Distortion:** FORBIDDEN to paraphrase, "improve", summarize, or alter the user's prompt. Forward text verbatim.
3. **Project Context & Attachment Quotas:** If the project contains existing files, `project_dir` MUST be provided. The server automatically attaches up to 4 project code files + 1 `task_prompt.txt` file (containing all remaining code 5..N) + up to 5 images/screenshots (total up to 10 files). For isolated changes, pass `target_files` (and optionally `images`).
4. **60-Second Timers:** Immediately upon submitting a task, Gemini schedules a 60-second timer via the `schedule` tool to poll progress with `mcp_qwen_check_status`.
5. **Verbatim File Writing (1:1):** Code is written to disk without deleting comments, altering logic, or truncating lines.
6. **Chunked Generation (Continuation):** For files exceeding 1000 lines, Qwen pauses with `### STATUS: NEED_CONTINUATION`. The orchestrator writes finished files and triggers `mcp_qwen_continue_task`.
7. **Mandatory Step 6 Verification:** Once all files are assembled on disk, `mcp_qwen_verify_task` is executed with the file tree and build/linter logs. Gemini awaits subagent confirmation (`ПРОЕКТ_СОБРАН_ВЕРНО`) before concluding.

---

## ⚙️ Under the Hood: CDP Automation Engine

### 1. Interactive Desktop Launch (`launchQwenWithDebugging`)
Standard `child_process.spawn` calls from agent background processes on Windows launch applications in disconnected session desktops (`exebox-...`), causing the GUI window to be invisible to the user.
The `QwenCDPAdapter` bypasses this by leveraging Windows Task Scheduler with the interactive flag:
```powershell
schtasks /create /tn "LaunchQwenMCP" /tr "\"C:\Program Files\Qwen\Qwen.exe\" --remote-debugging-port=9222" /sc once /st 00:00 /f /it
schtasks /run /tn "LaunchQwenMCP"
```
The `/it` switch guarantees that Windows spawns the GUI window directly on the user's **interactive desktop** (`WinSta0\Default`).

### 2. Attaching to `<webview>` Targets
Qwen Studio is an Electron application where `https://chat.qwen.ai/` is embedded inside a `<webview>` element. The adapter queries `http://localhost:9222/json/list` and specifically binds to targets where `type === 'webview'` and `url.includes('chat.qwen.ai')`.

### 3. Emulating Native React Input & Sending
Modern React inputs ignore raw `textarea.value = ...` assignments. The adapter invokes the native descriptor prototype setter followed by synthetic DOM events:
```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, 'value'
)?.set;
nativeSetter.call(textarea, promptText);
textarea.dispatchEvent(new Event('input', { bubbles: true }));
textarea.dispatchEvent(new Event('change', { bubbles: true }));
```
Following a 350ms tick (which allows React to toggle the voice microphone icon into the upward submit arrow), it clicks `button.send-button` (`aria-label="Отправить"`).

### 4. Monaco Editor Line Extraction
Qwen Studio displays code blocks using Microsoft Monaco Editor (`pre.qwen-markdown-code`). The adapter extracts lines directly from `.view-line` DOM elements, preserving exact indentation, linebreaks, and special characters without HTML entity distortion.

### 5. Task Store & Seamless Process Recovery Across Restarts
In environments like Google Antigravity, idle stdio MCP processes are terminated between tool invocations to conserve system resources (e.g., during 60-second `schedule` timer delays).
- All tasks, message history, status, and parsed code files are persisted to disk at `%TEMP%\qwen_mcp\tasks_store.json`.
- When `mcp_qwen_check_status` is triggered, the newly spawned MCP server process loads and merges tasks from disk.
- If a task was in `RUNNING` status, the server actively reconnects to the running Qwen Desktop instance via CDP (`cdpAdapter.getGenerationState()`). If generation finished while the MCP process was asleep, it captures the complete output, parses all files, sets `COMPLETED` / `NEED_CONTINUATION`, updates disk storage, and returns the finished files immediately!

---

## 🛠 Available MCP Tools

| Tool Name | Description |
|---|---|
| `mcp_qwen_submit_task` | Delegates a development task to Qwen subagent in background. Supports `project_dir` (full project tree, up to 10 file attachments: 4 code files + 1 prompt txt + up to 5 photos/screenshots), `images` (mockups, screenshots), `target_files` (targeted edits), and `attached_files`. Returns `task_id`. |
| `mcp_qwen_check_status` | Polls status (`RUNNING`, `COMPLETED`, `NEED_CONTINUATION`, `ERROR`), returns parsed files, structure, and `raw_response`. |
| `mcp_qwen_continue_task` | Sends continuation instruction to Qwen to output remaining project files. |
| `mcp_qwen_verify_task` | **Step 6 Verification:** Sends assembled structure, error logs, and rendering screenshots (`images`) to Qwen for visual confirmation. |
| `mcp_qwen_extract_and_write_files` | Verbatim file writer with path traversal protection. |
| `mcp_qwen_build_project_context` | Pre-scans project directory, builds tree, selects up to 4 code files and up to 5 images for attachments, and formats remaining code for prompt. |
| `mcp_qwen_get_config` | Returns active server configuration and diagnostic network probes. |
| `mcp_qwen_set_config` | Dynamically updates runtime configuration. |

---

## 🚀 Installation & Single-Click Quick Start

### Prerequisites
- **Node.js** v18 or later.
- **Qwen Studio Desktop** (default: `C:\Program Files\Qwen\Qwen.exe`) or Google Chrome.

### Step 1: Clone and Build
```bash
git clone https://github.com/ha1tek/antigravity-to-qwen-mcp.git
cd antigravity-to-qwen-mcp
npm install
npm run build
```

### Step 2: Register in Your AI Assistant

#### For Google Antigravity:
Add to `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "qwen": {
      "command": "node",
      "args": ["C:\\ai_projects\\qwen_mcp\\build\\index.js"]
    }
  }
}
```

#### For Claude Desktop:
Add to `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "qwen": {
      "command": "node",
      "args": ["C:\\ai_projects\\qwen_mcp\\build\\index.js"]
    }
  }
}
```

#### For Cursor IDE:
In `Settings > Features > MCP`:
- **Name:** `qwen`
- **Type:** `command`
- **Command:** `node C:\ai_projects\qwen_mcp\build\index.js`

### 💡 Zero-Configuration Auto-Launch
You do **not** need to manually create shortcuts or launch batch scripts. Upon the first tool invocation, the server automatically checks if Qwen is running, launches it with remote debugging on port 9222 on your screen, and submits the prompt.

---

## 📖 Step-by-Step Usage Scenarios

### Scenario 1: Developing a Project from Scratch
1. **User:** *"Create a full-stack REST API with FastAPI, JWT auth, and SQLite."*
2. **Gemini (Orchestrator):** Calls `mcp_qwen_submit_task`, sets a 60-second timer via `schedule`.
3. **Qwen (Subagent):** Generates tree structure and full code for each file (`app/main.py`, `app/auth.py`, etc.).
4. **Gemini (Orchestrator):** Polls status, writes files verbatim to disk, verifies syntax, calls `mcp_qwen_verify_task`, and presents the result upon Qwen's approval.

### Scenario 2: Modifying an Existing Project (Context + Attachments + Embedded Files)
When working on an existing codebase that needs new features or refactoring:
1. Gemini passes `project_dir: "C:\\projects\\my_app"` (and optionally `images: ["C:\\photos\\mockup.png"]`).
2. The MCP server automatically:
   - Scans and builds a complete directory tree.
   - Allocates attachments up to **10 files (up to 5 documents + up to 5 images)**:
     * **Up to 5 documents**: up to 4 key project code files attached as documents (`type: ["document"]`) + 1 `task_prompt.txt` file (containing full prompt, directory tree, and full code of all remaining files 5..N), avoiding the 131,072 character textarea limit.
     * **Up to 5 images**: auto-scanned from project image folders (`references_photos/`, `screenshots/`, `assets/`, `mockups/`) or passed via `images` parameter, attached as vision attachments (`type: ["vision"]`).
3. Qwen 3.8 Max (with 1,000,000+ token context window) processes the entire project codebase, references, and screenshots in a single request with full architectural awareness.

### Scenario 3: Targeted Single-File Edit
When only a single component or isolated bug fix is needed:
1. **User:** *"Fix email validation regex in src/auth/validator.ts."*
2. Gemini passes `target_files: ["src/auth/validator.ts"]`.
3. The server attaches **ONLY that file** without rescanning or re-sending the whole project, conserving tokens and maximizing focus.

### Scenario 4: Large Codebases (>1000 lines per file)
1. Qwen outputs full code up to the token boundary and stops with:
   ```markdown
   ### STATUS: NEED_CONTINUATION
   Remaining files: components/Dashboard.tsx, utils/analytics.ts
   ```
2. Gemini writes completed files to disk and triggers `mcp_qwen_continue_task`.
3. Cycles repeat automatically until `### STATUS: ALL_FILES_COMPLETED`.

### Scenario 5: Automated Build Error Fixing
1. If TypeScript compilation fails:
2. Gemini sends error diagnostics via `mcp_qwen_verify_task`:
   ```json
   {
     "task_id": "qwen_task_...",
     "assembled_structure": "src/index.ts, src/types.ts",
     "verification_status": "ERRORS_FOUND",
     "error_log": "TS2322: Type 'string' is not assignable to type 'number' at src/index.ts:42",
     "troubled_files": [
       { "path": "src/index.ts", "content": "...source code..." }
     ]
   }
   ```
3. Qwen identifies the bug, returns the corrected file, and Gemini updates the disk.

---

## 🔄 Adapting the Code to ANY Other AI Chat

The adapter in [`src/adapters/qwen_cdp_adapter.ts`](src/adapters/qwen_cdp_adapter.ts) is modular and can be adapted to any web chat or browser-based AI interface.

### 1. Adapting for Web AI Chats in Google Chrome

To use **ChatGPT, Claude.ai, DeepSeek, Google AI Studio, or Perplexity**:

#### Step A: Launch Chrome with Remote Debugging
```cmd
chrome.exe --remote-debugging-port=9222 "https://chatgpt.com"
```

#### Step B: Adjust Target Matching in `findQwenTarget`
```typescript
public async findQwenTarget(): Promise<CDPTarget> {
  const targets = await this.getTargets();
  const target = targets.find(
    (t) => t.type === 'page' && t.url.includes('chatgpt.com')
  );
  if (!target) throw new Error('ChatGPT tab not found in Chrome!');
  return target;
}
```

#### Step C: DOM Selector Reference Table

| Service | Input Selector (`textarea`) | Submit Button (`sendBtn`) | Generation Flag (`isGenerating`) | Response Container |
|---|---|---|---|---|
| **ChatGPT** | `#prompt-textarea` | `button[data-testid="send-button"]` | `button[data-testid="stop-button"]` | `div[data-message-author-role="assistant"]` |
| **Claude.ai** | `div[contenteditable="true"]` | `button[aria-label="Send Message"]` | `button[aria-label="Stop response"]` | `.font-claude-message` |
| **DeepSeek** | `textarea` | `.chat-input-send-button` | `.chat-input-stop-button` | `.ds-markdown` |
| **Google AI Studio** | `textarea.mat-input-element` | `button.run-button` | `mat-spinner, button.stop-button` | `.model-response-text` |
| **Perplexity** | `textarea[placeholder*="Ask"]` | `button[aria-label="Submit"]` | `button[aria-label="Stop"]` | `.prose` |

---

### 2. Adapting for Chrome DevTools Browser / Headless Mode

Run without any visible browser window:
```bash
chrome.exe --headless=new --remote-debugging-port=9222 "https://chat.qwen.ai"
```
CDP features available:
- **Screenshots:** Capture page snapshots with `Page.captureScreenshot`.
- **SSE Stream Sniffing:** Listen to streaming responses via `Network` domain.
- **Script Evaluation:** Interact directly via `Runtime.evaluate`.

---

### 3. Adapting for Local WebUIs (Ollama, LM Studio)

- **Via WebUI:** Open Ollama OpenWebUI (`http://localhost:3000`) in Chrome on port 9222 and target its URL.
- **Via Direct REST API:** Switch `mode` to `"api"` in `config.json`:
  ```json
  {
    "mode": "api",
    "apiBaseUrl": "http://localhost:11434/v1",
    "model": "qwen2.5-coder:32b",
    "apiKey": "ollama"
  }
  ```

---

## 🔧 Configuration (`config.json`)

```json
{
  "mode": "auto",
  "cdpHost": "127.0.0.1",
  "cdpPort": 9222,
  "qwenExePath": "C:\\Program Files\\Qwen\\Qwen.exe",
  "apiBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "",
  "model": "qwen-max",
  "timeoutSeconds": 300
}
```

---

## 📂 Project File Structure

```
antigravity-to-qwen-mcp/
├── src/
│   ├── index.ts                     # MCP Server entry point, tools, instructions
│   ├── task_manager.ts              # Task lifecycle manager, continuation, verification
│   ├── parser.ts                    # File tree, ### FILE: tag & status parser
│   ├── file_writer.ts               # Verbatim file writer with path-traversal safety
│   ├── config.ts                    # Config loader & serializer
│   ├── types.ts                     # TypeScript models and interfaces
│   └── adapters/
│       ├── qwen_cdp_adapter.ts      # CDP client (interactive launch, input, Monaco reader)
│       └── qwen_api_adapter.ts      # OpenAI-compatible API client (DashScope)
├── tests/
│   ├── run_all_tests.js             # Test runner
│   ├── test_parser.js               # Unit tests for parser and chunking
│   └── test_server_mcp.js           # MCP protocol & JSON-RPC integration tests
├── instructions.md                  # Orchestrator best practices for AI agents
├── GEMINI.md                        # Gemini orchestration rules
├── package.json                     # Package metadata and scripts
├── tsconfig.json                    # TypeScript compiler config
├── LICENSE                          # MIT License
├── README.md                        # Russian documentation
└── README.en.md                     # English documentation
```

---

## 🧪 Automated Testing

Execute the test suite:
```bash
npm test
```

Verifies:
- File tree parsing and `### FILE:` block extraction.
- Chunked continuation protocol (`### STATUS: NEED_CONTINUATION`).
- Verbatim file writer with path traversal protection.
- Full MCP JSON-RPC handshake and tool discovery.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
