# SADIE - Structured AI Desktop Intelligence Engine

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)
[![Playwright](https://img.shields.io/badge/Playwright-45ba4b?style=for-the-badge&logo=Playwright&logoColor=white)](https://playwright.dev/)

> A secure, cross-platform desktop AI assistant built with Electron that provides structured tool-based AI interactions while maintaining strict security boundaries and offline-first operation.

## ✨ Features

### 🔍 Web Intelligence Tools
- **Multi-Engine Web Search**: DuckDuckGo, Google, and Brave search with automatic content fetching
- **Safe URL Fetching**: SSRF-protected content extraction with DNS validation
- **Weather Information**: Real-time weather data via wttr.in (no API keys required)

### 📄 Document Processing
- **PDF & Text Analysis**: Local document processing with mammoth and pdf-parse
- **Content Extraction**: Intelligent text extraction from various document formats

### 🎤 Speech & Audio
- **Offline Speech Recognition**: Local STT using whisper-node
- **Audio Processing**: Real-time audio capture and processing

### 🖼️ Image Processing
- **Local Image Analysis**: Client-side image processing capabilities
- **Format Support**: Multiple image format handling

### 🔒 Security Features
- **URL Safety Validation**: Comprehensive SSRF protection with DNS resolution checks
- **Process Isolation**: Electron main/renderer separation with secure IPC
- **Input Sanitization**: All inputs validated and sanitized
- **Compile-time Gating**: Development code automatically removed in production builds

## 🏗️ Architecture

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
│  │   Web Search    │  │   URL Fetch     │  │   Weather API   │ │
│  │   (DuckDuckGo)  │  │   (Safe HTTP)   │  │   (wttr.in)     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │ │
│  │                                                                │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │ │
│  │  │ Document Tools  │  │   Speech Tools  │  │   Image Tools   │ │
│  │  │   (PDF/Text)    │  │   (Offline STT) │  │   (Processing)  │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘ │ │
│  │                                                                │ │
│  └─────────────────────── AI Model Integration ──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Windows 10+, macOS 10.15+, or Linux

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/kingithegreat/sadie.git
   cd sadie/widget
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Playwright browsers** (for E2E testing)
   ```bash
   npx playwright install --with-deps
   ```

### Development

                                 ## Architecture: Permissions & Batching

                                 High-level flow (permissions and batch execution):

                                 - Batch precheck: when a batch of tool calls is requested, `executeToolBatch()` inspects all unique tools and their declared `requiredPermissions` before executing any tool.
                                 - `requiredPermissions` (tool definition): tools declare any named permissions they require (for example, a report generator declares `['write_file']`). These are discovered by the batch precheck so nested permissions are not missed.
                                 - `overrideAllowed` (ToolContext): used for "Allow once" semantics. When the user chooses Allow once, the router re-invokes the batch with `overrideAllowed` set for the current execution; tools should consult this transient list when checking permissions.
                                 - Re-execution semantics: if precheck finds missing permissions, the batch returns a `needs_confirmation` result (no tools run). The router prompts the user; on `allow_once` the batch is retried with `overrideAllowed`, on `always_allow` the setting is persisted and the batch is retried normally.

                                 This section is the canonical reference for contributors implementing or modifying permission-related code.

1. **Start development mode**
   ```bash
   npm run dev
   ```

2. **Run tests**
   ```bash
   npm run test
   ```

3. **Run E2E tests**
   ```bash
   npm run e2e
   ```

### Production Build

1. **Build for production**
   ```bash
   npm run build
   ```

2. **Package application**
   ```bash
   npm run dist
   ```

## 📋 Usage

### First Launch
- Launch SADIE to see the first-run modal
- Review privacy settings and telemetry preferences
- Configure your preferences in the settings panel

### AI Interactions
SADIE uses a structured tool-based approach for AI interactions:

- **Web Search**: "What are the current NBA standings?"
- **Weather**: "What's the weather in Tokyo?"
- **URL Fetching**: "Summarize https://example.com/article"
- **Document Analysis**: Upload and analyze documents locally

### Security Features
- All web requests are validated for safety
- Local network access is blocked
- Private IP ranges are prohibited
- Content is processed client-side only

## 🧪 Testing

### Test Suite
- **Unit Tests**: Jest-based testing with TypeScript support
- **E2E Tests**: Playwright tests for complete user workflows
- **Security Tests**: Automated scanning for forbidden strings
- **Build Verification**: Preflight checks prevent unsafe releases

### Running Tests
```bash
# Unit tests
npm run test

# E2E tests (headed)
npm run e2e:headed

# E2E tests (headless)
npm run e2e
```

### CI behavior (short note)

- **Widget E2E (`widget-e2e.yml`)**: Runs on pull requests only (PRs -> feature branches). You may see "failed" runs on `main` with zero jobs — these are expected and can be ignored.
- **Release Gate**: The `Release Gate` workflow is the source of truth for `main` branch health and release readiness.
- **If you'd like**: we can add a cosmetic guard job or a README entry to change visibility later — nothing is required now.

## 🔒 Security

SADIE implements multiple layers of security:

- **URL Safety**: DNS resolution and IP validation prevent SSRF attacks
- **Process Isolation**: Electron's context isolation prevents code injection
- **Input Validation**: All user inputs are sanitized and validated
- **Compile-time Security**: Development code is automatically removed in production
- **Privacy Controls**: User consent required for telemetry

## 📚 Documentation

### Core Documentation
- **[Architecture Overview](FINAL_ARCHITECTURE_DIAGRAM.md)** - System design and components
- **[Submission Overview](SUBMISSION_OVERVIEW.md)** - Project summary and features
- **[Demo Script](DEMO_SCRIPT.md)** - Step-by-step demonstration guide
- **[Evidence Index](EVIDENCE_INDEX.md)** - Comprehensive implementation evidence

### Development Documentation
- **[Developer Build Guide](DEVELOPER_BUILD_GUIDE.md)** - Setup and development instructions
- **[Testing Matrix](TESTING_MATRIX.md)** - Test coverage and scenarios
- **[Release Process](RELEASE_PROCESS.md)** - Build and deployment procedures
- **[Security & Compliance](SECURITY_AND_COMPLIANCE.md)** - Security measures and compliance

## 🛠️ Development

### Project Structure
```
widget/
├── src/
│   ├── main/           # Main process (Node.js)
│   │   ├── tools/      # AI tool implementations
│   │   ├── env.ts      # Environment detection
│   │   └── index.ts    # Application entry point
│   ├── preload/        # Preload scripts (security)
│   └── renderer/       # React UI components
├── dist/               # Built application bundles
├── scripts/            # Build and utility scripts
└── tests/              # Test files
```

### Key Technologies
- **Electron**: Cross-platform desktop framework
- **React**: UI framework with hooks
- **TypeScript**: Type-safe JavaScript
- **Webpack**: Module bundling and optimization
- **Jest**: Unit testing framework
- **Playwright**: E2E testing framework

### Build System
- **Webpack**: Multi-target bundling (main, preload, renderer)
- **DefinePlugin**: Compile-time constants and code elimination
- **Electron Builder**: Cross-platform packaging
- **Preflight Checks**: Automated security and quality verification

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for Toi Ohomai COMP.7112 / COMP.7203 assessment
- Electron community for the excellent framework
- Open source AI and security communities
- DuckDuckGo for privacy-focused search capabilities

## 📞 Contact

**Project Author**: kingithegreat
**Repository**: [https://github.com/kingithegreat/sadie](https://github.com/kingithegreat/sadie)

---

**SADIE** - Bringing safe, intelligent AI assistance to the desktop while protecting user privacy and security.
