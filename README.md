# Sadie 🌸

**A fully local, sweet, helpful, and safe AI assistant for Windows**

Sadie is your personal AI assistant that runs completely offline on your computer. She helps with file management, image analysis, voice transcription, planning, and more - all while keeping your data private and secure.

## ✨ Features

- 🏠 **Fully Local** - Runs entirely offline using Ollama
- 🎨 **Desktop Widget** - Beautiful, always-accessible interface
- 📁 **File Operations** - Read, write, organize files safely
- 👁️ **Vision** - Image description (LLaVA) and OCR (Tesseract)
- 🎤 **Voice Input** - Speech-to-text using Whisper
- 📧 **Email** - Draft and send emails
- 🌐 **API Integration** - Call external APIs
- 🧠 **Memory** - Remembers conversation context
- 📋 **Planning** - Break down complex tasks into steps
- 🔒 **Safety First** - Built-in protections against unsafe operations

## 🚀 Quick Start

### Prerequisites

1. **Python 3.8+** - [Download](https://www.python.org/downloads/)
2. **Ollama** - [Download](https://ollama.ai/download)
3. **Tesseract OCR** - [Download](https://github.com/UB-Mannheim/tesseract/wiki) (for vision features)

### Installation

```bash
# Clone repository
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie

# Install dependencies
pip install -r requirements.txt

# Start Ollama and pull models
ollama serve
ollama pull llama2
ollama pull llava  # For vision features
```

### Running Sadie

**Desktop Widget (GUI):**
```bash
python -m sadie.main
```

**Command Line:**
```bash
python -m sadie.main --cli
```

**Single Message:**
```bash
python -m sadie.main --message "Hello Sadie, what can you help me with?"
```

**Check Status:**
```bash
python -m sadie.main --status
```

## 📖 Documentation

- [Installation Guide](docs/INSTALLATION.md) - Detailed setup instructions
- [Usage Guide](docs/USAGE.md) - How to use Sadie effectively
- [API Documentation](docs/API.md) - Technical details and extending Sadie

## 🎯 What Can Sadie Do?

### File Management
- "Read my todo.txt file"
- "Create a new document with my notes"
- "List all files in my Downloads folder"
- "Move old files to Archive"

### Vision & OCR
- "Describe this image for me"
- "Extract text from this screenshot"
- "What do you see in this photo?"

### Voice Transcription
- "Transcribe this audio recording"
- Record and transcribe voice input in real-time

### Task Planning
- "Help me plan how to organize my workspace"
- "Break down the steps to create a presentation"
- "What's the best way to backup my documents?"

### And More
- Email drafting and sending
- API calls and web requests
- Conversation memory and context
- Multi-step task execution

## 🔒 Safety Features

Sadie is designed to be **safe by default**:

- ✅ Blocks access to system directories (Windows, System32, etc.)
- ✅ Requires confirmation for destructive operations
- ✅ Validates all file paths and operations
- ✅ Suggests safe alternatives for risky actions
- ✅ Configurable safety restrictions
- ✅ Transparent about what actions she can and cannot perform

## 🏗️ Architecture

```
┌─────────────────┐
│  Desktop Widget │ ← User Interface (PyQt5)
└────────┬────────┘
         │
┌────────▼────────┐
│ Core Assistant  │ ← Main orchestration
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼──┐  ┌──▼────┐
│Ollama│  │ n8n   │ ← Optional workflow engine
└───┬──┘  └───────┘
    │
┌───▼───────────────────────────┐
│      Module Router            │
├───────────────────────────────┤
│ • File Actions                │
│ • Vision (LLaVA + OCR)        │
│ • Voice (Whisper)             │
│ • Email                       │
│ • API                         │
│ • Memory                      │
│ • Planning                    │
└───────────────────────────────┘
```

## ⚙️ Configuration

Edit `config/config.yaml` to customize:

- Ollama model and settings
- n8n integration
- Module enable/disable
- Safety restrictions
- UI appearance
- File access permissions

## 🛠️ Development

### Project Structure

```
Sadie/
├── src/sadie/
│   ├── core/           # Core functionality
│   │   ├── assistant.py
│   │   ├── config.py
│   │   ├── ollama_client.py
│   │   ├── n8n_client.py
│   │   ├── safety.py
│   │   └── module_router.py
│   ├── modules/        # Functionality modules
│   │   ├── file_actions.py
│   │   ├── vision.py
│   │   ├── voice.py
│   │   ├── email.py
│   │   ├── api.py
│   │   ├── memory.py
│   │   └── planning.py
│   ├── ui/             # User interface
│   │   └── widget.py
│   ├── n8n_workflows/  # n8n templates
│   └── main.py         # Entry point
├── config/             # Configuration
├── docs/               # Documentation
└── README.md
```

### Adding Custom Modules

See [API.md](docs/API.md) for details on extending Sadie with custom modules.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- [Ollama](https://ollama.ai/) - Local AI model runtime
- [n8n](https://n8n.io/) - Workflow automation
- [Whisper](https://github.com/openai/whisper) - Speech recognition
- [LLaVA](https://llava-vl.github.io/) - Vision language model
- [Tesseract](https://github.com/tesseract-ocr/tesseract) - OCR engine

## 💬 Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check the [documentation](docs/)

---

Made with ❤️ for safe, local AI assistance
