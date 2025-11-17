# SADIE - Structured AI Desktop Intelligence Engine

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-in%20development-yellow.svg)]()

A fully local, privacy-first AI personal assistant system for Windows that combines n8n automation, Ollama LLMs, and an Electron-based desktop widget for intelligent, safe task automation.

## 🎯 Overview

**SADIE** runs 100% locally on your machine, ensuring complete privacy while providing powerful AI-assisted automation capabilities. It combines:

- **n8n** for workflow orchestration
- **Ollama** for local LLM inference (Llama3, LLaVA, Whisper)
- **Electron widget** for user interaction
- **Multi-layer safety validation** to prevent harmful actions
- **Modular tool architecture** for easy extensibility

## ✨ Key Features

- 🔒 **Privacy-first**: All data stays local, no cloud dependencies
- 🤖 **AI-powered**: Natural language interaction with tool-calling
- 🛡️ **Safety-focused**: Multi-layer validation with user confirmations
- 🔧 **Modular**: Easy to add new tools and capabilities
- 📝 **Transparent**: All actions logged and explainable
- 💾 **Memory**: Contextual memory for personalized assistance

## 🏗️ Architecture

```
┌─────────────┐
│   Widget    │  Electron UI (always accessible)
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐
│     n8n     │  Orchestration & routing
└──────┬──────┘
       │
       ├──► Ollama (LLM reasoning)
       ├──► PowerShell (file/system ops)
       ├──► Memory (context storage)
       └──► Tool Workflows (modular)
```

## 🚀 Quick Start

### Prerequisites

- Windows 10/11
- Node.js 18+
- Docker Desktop
- Ollama

### Installation

```powershell
# Clone the repository
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie

# Pull required Ollama models
ollama pull llama3.2:3b
ollama pull llava
ollama pull whisper

# Start n8n
docker-compose up -d

# Install widget dependencies
cd widget
npm install

# Build and run
npm start
```

## 📦 Project Structure

```
sadie/
├── widget/              # Electron desktop widget
├── n8n-workflows/       # n8n workflow definitions
├── prompts/             # LLM prompt templates
├── schemas/             # JSON schemas for validation
├── config/              # Configuration files
├── scripts/             # Automation scripts
├── memory/              # Local memory subsystem
├── tests/               # Test suite
└── docs/                # Documentation
```

## 🛠️ Available Tools

- **File Manager**: Read, write, search, organize files
- **Email Manager**: Send and manage emails
- **Vision Tool**: Screenshot analysis and OCR
- **Voice Tool**: Speech-to-text transcription
- **Planning Agent**: Multi-step task breakdown
- **Memory Manager**: Store and retrieve context
- **Search Tool**: Fast local file search
- **System Info**: Query system information

## 🔒 Safety Features

- **Path Whitelisting**: File operations restricted to safe directories
- **Action Confirmation**: Dangerous operations require user approval
- **Tool Allowlist**: Only approved tools can be executed
- **Audit Logging**: All actions logged for review
- **Schema Validation**: All tool calls validated against JSON schemas

## 📚 Documentation

- [Project Plan](PROJECT_PLAN.md) - Complete architecture and build plan
- [Environment Status](ENVIRONMENT_STATUS.md) - System requirements check
- [Setup Guide](docs/setup-guide.md) - Detailed installation
- [Architecture](docs/architecture.md) - System design
- [Safety Guidelines](docs/safety-guidelines.md) - Security considerations

## 🤝 Contributing

This project is in active development. Contributions welcome once core functionality is stable.

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

Built with:
- [n8n](https://n8n.io/) - Workflow automation
- [Ollama](https://ollama.ai/) - Local LLM runtime
- [Electron](https://www.electronjs.org/) - Desktop framework
- [React](https://react.dev/) - UI framework

## ⚠️ Status

**Currently in development** - Core functionality being implemented.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for detailed roadmap and progress tracking.

---

**Made with ❤️ for privacy-conscious automation**
