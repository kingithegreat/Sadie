# Sadie Quick Start Guide

Get up and running with Sadie in 5 minutes!

## Step 1: Install Prerequisites

### 1.1 Install Python
- Download Python 3.8+ from https://www.python.org/downloads/
- ✅ Check "Add Python to PATH" during installation

### 1.2 Install Ollama
- Download from https://ollama.ai/download
- Install and run Ollama
- Open a terminal and run:
  ```bash
  ollama pull llama2
  ```

## Step 2: Install Sadie

```bash
# Clone the repository
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie

# Install Python dependencies
pip install -r requirements.txt
```

## Step 3: Start Ollama

Make sure Ollama is running:

```bash
ollama serve
```

Leave this terminal window open.

## Step 4: Run Sadie

Open a new terminal in the Sadie directory and run:

### Option A: Desktop Widget (Recommended)
```bash
python -m sadie.main
```

A desktop widget will appear where you can chat with Sadie!

### Option B: Command Line
```bash
python -m sadie.main --cli
```

### Option C: Quick Test
```bash
python -m sadie.main --message "Hello Sadie!"
```

## Troubleshooting

### "Failed to connect to Ollama"
- Make sure Ollama is running: `ollama serve`
- Verify it's accessible: `curl http://localhost:11434/api/tags`

### "Module not found" errors
- Install dependencies: `pip install -r requirements.txt`
- Or install individually: `pip install pyqt5 requests pyyaml`

### Widget doesn't appear
- Try CLI mode: `python -m sadie.main --cli`
- Check display settings (widget might be off-screen)

## Next Steps

1. **Try these commands:**
   - "What can you help me with?"
   - "List files in my Documents folder"
   - "Help me plan a task"

2. **Read the documentation:**
   - [Installation Guide](docs/INSTALLATION.md) - Full setup details
   - [Usage Guide](docs/USAGE.md) - Examples and tips
   - [API Documentation](docs/API.md) - Technical details

3. **Customize Sadie:**
   - Edit `config/config.yaml` to customize behavior
   - Add safe directories for file access
   - Enable/disable modules

## Optional: Add Vision and Voice

### For Vision (Image description and OCR):
```bash
# Install Tesseract OCR
# Windows: Download from https://github.com/UB-Mannheim/tesseract/wiki
# Add to PATH

# Pull LLaVA model
ollama pull llava
```

### For Voice (Speech-to-text):
```bash
# Install ffmpeg
# Windows: Download from https://ffmpeg.org/download.html
# Add to PATH

# Whisper downloads automatically on first use
```

## Need Help?

- Check [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
- Run: `python -m sadie.main --status` to check system status
- Open an issue on GitHub

## Safety Note

Sadie is designed to be safe by default:
- ✅ Blocks access to system directories
- ✅ Requires confirmation for destructive operations
- ✅ Suggests safe alternatives
- ✅ Runs completely offline

Enjoy using Sadie! 🌸
