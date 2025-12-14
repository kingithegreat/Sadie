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

1. **Electron Framework**: Cross-platform desktop app with web technologies
2. **Process Isolation**: Main/Renderer separation with secure IPC communication
3. **Tool-Based Architecture**: Modular, extensible AI tool system
4. **Security-First Design**: Input validation, URL safety checks, SSRF protection
5. **Offline-First**: Local AI models with optional cloud fallback
6. **Type-Safe**: Full TypeScript implementation with strict typing

### Build & Deployment Architecture

```
Source Code → TypeScript → Webpack → Electron Builder → Platform Packages
     │             │            │                │
     └───── Lint ──┴─── Test ───┴─── Preflight ──┴─── Release
```

### Performance Optimizations

- **Lazy Loading**: Tools loaded on-demand
- **Caching**: Web requests and AI responses cached
- **Minification**: Production builds optimized
- **Tree Shaking**: Unused code eliminated
- **Compile-time Constants**: Environment-specific code gated at build time

### Monitoring & Diagnostics

- **Conditional Logging**: Environment-based diagnostic output
- **Error Boundaries**: Graceful error handling in UI
- **Build Verification**: Preflight checks prevent deployment of unsafe builds
- **Test Coverage**: Comprehensive E2E and unit testing

This architecture ensures SADIE is secure, performant, and maintainable while providing powerful AI assistance capabilities.