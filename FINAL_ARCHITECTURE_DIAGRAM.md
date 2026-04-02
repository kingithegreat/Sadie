# SADIE Final Submission - Architecture Diagram

## System Architecture Overview

SADIE (Structured AI Desktop Intelligence Engine) is an Electron-based desktop application that provides AI-powered assistance through a structured tool-based architecture.

### Core Architecture Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    SADIE Desktop Application                     │
│                    (Electron Framework)                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Main Process  │  │  Preload Script │  │ Renderer Process │ │
│  │   (Node.js)     │  │   (Security)    │  │   (React UI)     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│           │                       │                   │         │
│           └───────────────────────┼───────────────────┘         │
│                                   │                             │
│                    ┌──────────────┴──────────────┐              │
│                    │     IPC Communication       │              │
│                    │   (Context Isolation)       │              │
│                    └─────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI Tool System                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Message       │  │   Tool Router   │  │   Tool Handlers  │ │
│  │   Router        │  │                 │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  │                                                                │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  │   Web Search    │  │   URL Fetch     │  │   Weather API   │ │
│  │  │   (DuckDuckGo)  │  │   (Safe HTTP)   │  │   (wttr.in)     │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘ │ │
│  │                                                                │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  │ Document Tools  │  │   Speech Tools  │  │   Image Tools   │ │
│  │  │   (PDF/Text)    │  │   (Offline STT) │  │   (Processing)  │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘ │ │
│  │                                                                │
│  └─────────────────────── AI Model Integration ──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External AI Services                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   OpenAI API    │  │   Local Models  │  │   Web Search     │ │
│  │   (GPT-4)       │  │   (Transformers)│  │   (DuckDuckGo)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │ │
└─────────────────────────────────────────────────────────────────┘
```

### Security & Safety Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Layers                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Input         │  │   Process       │  │   Output        │ │
│  │   Validation    │  │   Isolation     │  │   Sanitization  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │ │
│  │         │                       │                   │       │ │
│  │  ┌──────▼──────┐       ┌────────▼────────┐   ┌──────▼──────┐ │ │
│  │  │URL Safety    │       │Context Bridge   │   │Content      │ │ │
│  │  │Checks        │       │(IPC Security)   │   │Filtering     │ │ │
│  │  └─────────────┘       └─────────────────┘   └─────────────┘ │ │
│  │                                                                │ │
│  └─────────────────────── Compile-time Gating ───────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Architecture

```
User Input → React UI → IPC → Main Process → Tool Router → AI Tools → External APIs
      ↑                                                                       ↓
      └───────────────────────────────────────────────────────────────────────┘
                              Response Processing & Display
```

### Key Architectural Decisions

1. **Electron 28 Framework**: Desktop app with React + TypeScript UI
2. **Process Isolation**: Main/Renderer separation with secure IPC, context isolation enabled
3. **Tool-Based Architecture**: 20+ modular tool handlers executed locally via TypeScript
4. **Security-First Design**: SSRF protection, webhook auth, IPC hardening, tool recursion cap
5. **Offline-First**: Local Ollama models with optional cloud LLM routing
6. **Type-Safe**: TypeScript strict mode with `noUnusedParameters`, `exactOptionalPropertyTypes`
7. **Theming**: Light / dark / system theme via CSS variables and `data-theme` attribute
8. **Auto-Update**: electron-updater with background download and IPC progress events

### Build & Deployment Architecture

```
Source Code → TypeScript → electron-vite → Electron Builder → NSIS Installer
     │             │            │                │
     └───── Lint ──┴─── Test ───┴─── Preflight ──┴─── Release
```

Test suite: 87 Jest suites / 1339 unit tests + 12+ Playwright E2E scenarios.

### Performance Optimizations

- **Lazy Loading**: Tools loaded on-demand
- **Caching**: Web requests and AI responses cached; Pollinations availability cache
- **Log Buffer Caps**: Main-process and router logs capped at 500 entries
- **Context Budget**: Small models (≤3B) get scaled-down context injection
- **Digest Compression**: Rolling context extracts first/last sentence instead of blind truncation
- **Compile-time Constants**: Environment-specific code gated at build time

### UI Architecture

- **Theme System**: CSS custom properties (`--bg-*`, `--accent-*`, `--text-*`) with `[data-theme]` selectors
- **Futuristic Accents**: 15+ CSS keyframe animations, glass morphism, neon glows
- **Accessibility**: `@media (prefers-reduced-motion: reduce)` disables all animations
- **Custom Markdown Renderer**: Fenced code blocks with copy button, inline formatting
- **Streaming UI**: Real-time token-by-token response display with cancel/retry

### Monitoring & Diagnostics

- **Conditional Logging**: Environment-based diagnostic output
- **Error Boundaries**: Graceful error handling in UI
- **Build Verification**: Preflight checks prevent deployment of unsafe builds
- **Test Coverage**: Comprehensive E2E and unit testing

This architecture ensures SADIE is secure, performant, and maintainable while providing powerful AI assistance capabilities.