SADIE Project – Technical Analysis & Status Report
1. Project Overview

SADIE (Structured AI Desktop Intelligence Engine) is a privacy-first, fully local AI desktop assistant designed to provide intelligent automation and tool-calling capabilities without relying on external cloud services.

It integrates multiple components so that a user can converse with an AI assistant and have it safely perform real actions on their machine (file management, web search, system queries, etc.), under strict safety and permission models.

Purpose

Provide a secure, extensible AI assistant running entirely on the user's machine.

Use:

n8n for workflow orchestration,

Ollama for local LLM inference (e.g., llama3.2:3b, LLaVA),

PowerShell and TypeScript tools for system-level operations,

An Electron-based widget as the interactive desktop UI.

Emphasize:

Safety (path whitelisting, confirmation for destructive actions, permission gating),

Modularity (tool-based design),

Privacy (no cloud persistence, telemetry opt-in only).

Main Functionality

Conversational AI
Users interact through a chat interface (Electron widget) with messages like:

"Search the web for today's Warriors game."

"Create a file in my Desktop\test folder."

"What's the weather in Tauranga?"

Tool Execution
Requests are routed through n8n workflows to tools such as:

File manager tools (PowerShell: FileOps.ps1),

Web tools (TypeScript: web.ts, Electron main),

System information tools (SystemInfo.ps1),

Future tools: email, voice, etc.

Safety Validation
All tool calls are:

Validated via safety JSON (e.g., safety-validator.json, safety-rules.json),

Checked against:

Path whitelists (Desktop/Documents/Downloads),

Blocked extensions (.exe, .dll, .sys, etc.),

Permission flags (e.g., delete_file, move_file, launch_app),

Confirmation requirements for destructive operations.

Persistence

Conversation history and configuration stored locally (e.g., JSON store under app.getPath('userData')).

No cloud-based state.

Key Tools (Current Set)

File operations (read/write/list/move/delete/info/search),

Web search and URL fetching (web.ts),

Weather lookup,

System info,

Memory & clipboard utilities,

Voice/vision hooks (backend ready; partial UI).

High-Level Architecture

Electron Widget (UI) ↔ Electron Main / IPC ↔ n8n Orchestrator ↔ Ollama (LLM) ↔ Tools (PowerShell / TypeScript)

Data is passed as JSON between layers; tools and permissions are centrally controlled.

The active file web.ts implements web-related tools (search, URL fetch, weather), defines tool schemas, and provides HTTP/HTML helper functions. It is used by the Electron main process as part of the "web_search" and "fetch_url" tools exposed to the assistant.

2. Current Status

Based on COMPLIANCE_REPORT.md, PROJECT_PLAN.md, and recent code changes, SADIE is roughly 65–70% functionally complete. The backend and core security model are strong; the Electron widget and testing infrastructure now exist and are usable, but there are still gaps.

2.1 Implemented and Working

Backend Orchestration (n8n)

Main orchestrator (main-orchestrator.json) is implemented and functional.

Handles:

Conversation flow,

Safety validation,

Tool routing,

Memory persistence (/data/memory).

Integrated with Ollama (e.g., llama3.2:3b) for local inference.

Safety System

Implemented via safety-validator.json and safety-rules.json.

Enforces:

Path whitelisting (Desktop/Documents/Downloads),

Blocked extensions (.exe, .dll, .sys, .ps1, etc.),

Confirmation for destructive actions (e.g., delete, move),

Tool-level permission flags (e.g., launch_app, screenshot).

Central permission gating added in the tool execution path in the Electron main process.

PowerShell Tools

Approximately 1,450+ lines of PowerShell:

FileOps.ps1: read/write/list/move/delete/search/get-info,

SystemInfo.ps1: system, disk, memory, processes, network,

SafetyValidation.ps1: path and operation validation.

Tested locally with manual test cases and structured logs.

Configuration & Schemas

JSON schemas for tool calls and safety rules (e.g., tool-call-schema.json).

default-config.json defines sane defaults.

docker-compose.yml sets up n8n with proper volume mounts for persistence.

Web Tools (web.ts, Active File)

web.ts is implemented with three main tools:

web_search

Uses external search engines (DuckDuckGo / Google / Brave) without API keys.

Schema defined (query, maxResults, optional content fetching).

Handler normalizes search results for the LLM.

fetch_url

Fetches URL content using Node's HTTP/HTTPS modules.

Uses stripHtml helper to extract readable text.

get_weather

Calls wttr.in for weather data.

No API key needed.

Helpers:

httpGet: robust HTTP client with timeout and error handling.

stripHtml: HTML → plain text sanitization.

Electron Widget (UI) – NOW IMPLEMENTED

Core features:

Chat interface:

User and assistant message bubbles,

Streaming indicator (animated dots, "Generating…" state),

Stop button for cancelling generation,

Attachment buttons for images/docs,

Voice button (hooked, permission-controlled).

First-Run Onboarding:

Modal that appears on first launch.

Lets user configure:

Telemetry (opt-in, default OFF),

Tool permissions (dangerous tools OFF by default),

Default NBA team (e.g., "GSW"),

Writes persistent settings to config.json in userData.

Settings Panel:

Displays current permissions and telemetry status.

Includes "Export consent JSON" for telemetry audit.

Allows toggling individual tool permissions and telemetry (with consent modal).

Telemetry & Consent Logging

Telemetry is OFF by default.

Enabling telemetry:

Triggers a TelemetryConsentModal.

Only after explicit user acceptance:

config.telemetryEnabled = true,

telemetryConsentVersion set (e.g., "1.0"),

Consent logged to logs/telemetry-consent.log (JSONL).

Export button:

Writes a consent snapshot JSON file to logs,

Used for audit and compliance proof.

Testing

Unit tests:

Cover config manager, telemetry consent logic, and some tool permission pathways.

Playwright E2E tests (in src/renderer/e2e):

First-run onboarding:

Fresh profile → onboarding visible, safe defaults,

Relaunch with same profile → onboarding no longer shown,

Telemetry decline flow (toggle ON, decline modal → telemetry remains disabled).

Streaming tests (in progress but mostly wired):

Streams chunks to UI,

Cancel stops stream,

Handles upstream error.

Infrastructure & Environment

Environment is ready and validated:

Node.js 24.6.0,

npm 11.5.1,

Docker 28.4.0,

Ollama 0.12.11 with llama3.2:3b and LLaVA,

PowerShell on Windows 10,

Electron build pipeline (portable ZIP build confirmed).

2.2 Partially Complete / In Progress

n8n Workflows

Implemented: ~6/9 core tool workflows (e.g., file-manager.json, web-tool.json, system-info.json, vision-tool.json).

Missing or partial:

email-manager.json,

voice-tool.json,

Possibly a dedicated search-tool.json separate from the main orchestrator.

Tool routing logic currently resides largely inside the main orchestrator rather than a discrete tool-router.json.

Testing Infrastructure

Jest and Playwright are wired in.

First-run E2E tests pass; some streaming tests still require stable mock mode configuration.

PowerShell test cases exist on paper (PHASE_6_CHECKLIST.md) but are not fully automated.

Documentation

Approximately ~50% complete:

Strengths:

PROJECT_PLAN.md is very detailed,

powershell-scripts.md documents script behavior,

Compliance notes present in COMPLIANCE_REPORT.md.

Missing:

docs/architecture.md,

docs/setup-guide.md,

Full docs/api-reference.md for tools/IPC.

2.3 Broken or Needs Fixing / Hardening

Streaming E2E Tests:

Still occasionally hitting the real model instead of a deterministic mock.

Need a strict SADIE_E2E or similar flag in the streaming provider to emit test chunks.

Web Tool Configurability:

Search engines and timeouts are currently hardcoded in web.ts.

No caching or user-level configuration for search providers.

Setup / Deployment Automation:

Setup scripts (scripts/setup/...) and deployment scripts are incomplete or minimal.

No single "one-click" script for:

Installing Ollama,

Pulling required models,

Importing all n8n workflows.

UI Accessibility & Polish:

Basic ARIA and keyboard navigation need improvement.

No integrated consent log viewer yet (export-only).

3. Code Quality Assessment
3.1 Overall Organization

Strengths

Clear modular structure:

src/main/tools for TypeScript tools (including web.ts),

Dedicated PowerShell tools folder,

Electron-specific code separated into main/renderer/preload.

Strong emphasis on:

Safety and validation,

Tool schemas and structured JSON,

Separation of concerns between UI, orchestration, and tools.

Weaknesses

Some planned modules (email, calendar, voice UI flows) are still stubs.

Hardcoded web configuration (search engines, timeouts) in web.ts.

Not all cross-cutting behaviors (logging, caching, telemetry) are applied uniformly.

3.2 web.ts – File-Level Assessment

Clean TypeScript, with clear sections for:

Tool definitions,

Helper functions,

Handlers.

httpGet:

Handles redirects and timeouts correctly.

stripHtml:

Reasonable HTML-to-text conversion via regex.

Engine-specific search functions (DuckDuckGo/Google/Brave) are somewhat duplicated, which suggests future refactoring into a strategy pattern or pluggable provider system.

3.3 Technical Debt / Refactoring Targets

Search engine abstraction:

Replace engine-specific functions with a common interface and provider registry.

Error handling consistency:

n8n workflows need more robust failure paths and user-facing error messages.

Security hardening:

Add URL validation in fetchUrlHandler to detect obviously malicious URLs (e.g., file://, internal-only hosts).

Performance:

Introduce basic caching for repeated web searches and fetches.

TypeScript strictness:

Consider enabling stricter compiler options and adding more types in newly added areas.

3.4 Test Coverage Status

Unit tests: present but not comprehensive.

E2E:

First-run onboarding and config persistence covered.

Streaming behavior covered but requires robust mock mode.

PowerShell scripts: test cases defined but not fully automated.

4. Dependencies & Configuration
4.1 Key Dependencies

Runtime:

Node.js 24.6.0,

npm 11.5.1,

Docker 28.4.0.

AI / ML:

Ollama 0.12.11 (llama3.2:3b, LLaVA).

Desktop App:

Electron 28.x,

React 18.x,

TypeScript 5.x,

Webpack 5.x.

Testing:

Jest 29.x,

Playwright 1.49.x.

web.ts relies only on Node's built-in http/https modules, which is good from a security and maintenance perspective.

4.2 Configuration Status

Complete or near-complete:

docker-compose.yml (n8n + volumes),

safety-rules.json, tool-allowlist.json,

default-config.json,

Telemetry/permissions config persisted in userData.

Partial:

Some workflow import scripts and setup automation.

Web configuration is static and hardcoded instead of user or config-driven.

5. Next Steps & Recommendations
5.1 Immediate (High Priority, Short Term)

Enforce Streaming Mock Mode in E2E

Add SADIE_E2E or equivalent env flag in the streaming provider.

When set, emit deterministic chunk-1…chunk-5 instead of calling the real model.

This will stabilize streaming.e2e.spec.ts.

Finalize Widget UX for Permissions & Telemetry

Add explanatory tooltips for dangerous tools (delete, move, launch_app, screenshot).

Add clear privacy text near telemetry toggle ("anonymous, opt-in only, locally logged consent").

Wire Remaining n8n Workflows

Implement missing workflows (email-manager, voice-tool, search-tool if separate).

Ensure web tools (web.ts) are reachable via n8n where appropriate.

5.2 Short-Term (2–4 Weeks)

Automate Setup

Scripts for:

Installing Ollama and pulling required models,

Importing all n8n workflows,

Running initial health checks.

Extend Testing

Unit tests for:

web.ts (mock httpGet),

Tool permission gating.

PowerShell test automation wrapped in a script or CI step.

Complete Documentation

docs/architecture.md: diagrams + data flow.

docs/setup-guide.md: step-by-step install and run.

docs/api-reference.md: tool schemas, IPC interface, and permissions.

5.3 Medium-Term Improvements

Refactor web.ts for Extensibility

Introduce a pluggable search engine interface.

Add simple in-memory or on-disk caching for search/fetch results.

Enhance Safety & Monitoring

URL validation and categorization for fetch_url.

Surface consent and permission logs in the UI (read-only view).

CI Hardening

Require green:

Unit tests,

E2E critical path tests,

Lint + type-check,

Production build.

6. Overall Conclusion

SADIE has moved beyond a back-end prototype into a coherent, end-to-end local AI assistant, with:

A functional Electron desktop widget,

Strong safety and permissions architecture,

Privacy-first telemetry with explicit consent logging,

Robust backend orchestration in n8n and PowerShell,

A growing test suite (unit + Playwright E2E).

The main remaining work is hardening and polish rather than fundamental architecture:

Stabilizing E2E (mocked streaming),

Completing missing workflows and setup automation,

Improving documentation and UX clarity.

From an academic and professional perspective, SADIE demonstrates a well-thought-out security model, real engineering depth, and a clear path to production readiness.

If you tell me where you want to use this (COMPLIANCE_REPORT, AUDIT_SUMMARY, README, etc.), I can also produce a shorter executive summary version tailored for markers or stakeholders.
