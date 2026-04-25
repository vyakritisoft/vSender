# GEMINI.md

## Purpose

This document provides instructions for Antigravity (Gemini 3.0 Pro IDE) to use PROJECT.md and DESIGN.md as the single source of truth and generate a complete, production-grade Chrome Extension.

---

## 🔥 CORE INSTRUCTION

You MUST treat the following documents as authoritative:

- PROJECT.md → Product requirements & scope
- DESIGN.md → Technical architecture & system design

DO NOT deviate unless absolutely necessary.

---

## 🎯 OBJECTIVE

Generate a fully working Chrome Extension (Manifest V3) that implements everything defined in the above documents.

---

## 📦 EXPECTED OUTPUT

You must generate:

### 1. Complete Project Structure

- manifest.json
- background/service worker
- content scripts
- popup UI (HTML/CSS/JS or framework)
- core modules (queue, parser, templating, rate limiter, logger)

---

### 2. Implementation Requirements

#### Queue Engine

- FIFO queue
- State machine:
  PENDING → SENDING → SENT / FAILED / RETRY
- Persist queue in chrome.storage

#### Rate Limiter

- Configurable delay
- Random jitter (±20–30%)
- Session caps

#### CSV/XLSX Parser

- Parse and validate schema
- Normalize phone numbers (E.164)
- Handle invalid rows gracefully

#### Template Engine

- Replace {{variables}}
- Support fallback values

#### WhatsApp Automation Layer

- DOM-based interaction only
- No unofficial APIs
- Use MutationObserver for stability
- Implement selector abstraction layer

#### Media Sending

- Attach image/pdf
- Wait for preview before sending

#### Error Handling

- Timeout detection
- Retry with exponential backoff
- Graceful failure logging

---

### 3. UI Requirements

#### Popup UI

- File upload
- Field mapping
- Message preview
- Delay configuration
- Media upload
- Start / Pause / Stop controls
- Progress tracking

#### Injected WhatsApp Button

- Add “Bulk Sender” button inside WhatsApp Web UI

---

### 4. Communication Model

Use:

- chrome.runtime.sendMessage
- chrome.tabs messaging

Define event types:

- START
- PAUSE
- RESUME
- STOP
- STATUS_UPDATE

---

### 5. Code Quality Standards

- Modular and clean architecture
- Reusable components
- No hardcoded selectors (use abstraction layer)
- Proper error handling
- Comments where necessary

---

### 6. Anti-Ban Strategy (CRITICAL)

- Always send messages one-by-one
- Apply randomized delays
- Limit messages per session
- Simulate human typing (optional but recommended)
- Avoid parallel execution

---

### 7. Edge Cases to Handle

- WhatsApp not logged in
- Network interruption
- Invalid phone numbers
- DOM changes or missing elements
- Duplicate contacts

---

### 8. Testing

- Provide basic test strategy
- Ensure extension loads without errors
- Ensure messaging flow works reliably

---

## 🚫 RESTRICTIONS

- Do NOT use unofficial WhatsApp APIs
- Do NOT implement aggressive bulk sending
- Do NOT skip delay logic

---

## 🧠 EXECUTION STRATEGY

Follow this order:

1. Generate project structure
2. Implement core modules
3. Implement background worker
4. Implement content script (automation layer)
5. Implement popup UI
6. Connect messaging system
7. Add logging and persistence
8. Final integration and validation

---

## 🎯 FINAL GOAL

The output must be a **fully functional, production-ready Chrome Extension** that can be loaded via "Load Unpacked" and used immediately.

Do NOT provide partial implementations.

Generate complete code now.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
