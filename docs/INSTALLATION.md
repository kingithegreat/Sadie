# Sadie Installation Guide

## Prerequisites

### Required Software
1. **Python 3.8 or higher**
   - Download from: https://www.python.org/downloads/
   - Make sure to add Python to PATH during installation

2. **Ollama**
   - Download from: https://ollama.ai/download
   - Install and run Ollama
   - Pull required models:
     ```bash
     ollama pull llama2
     ollama pull llava  # For vision capabilities
     ```

3. **n8n (Optional but recommended)**
   - Install via npm:
     ```bash
     npm install -g n8n
     ```
   - Or use Docker:
     ```bash
     docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n
     ```

4. **Tesseract OCR (for vision/OCR capabilities)**
   - Windows: Download from https://github.com/UB-Mannheim/tesseract/wiki
   - Add Tesseract to PATH

### Optional Software
- **Whisper dependencies** (for voice capabilities)
  - Install ffmpeg: https://ffmpeg.org/download.html

## Installation Steps

### 1. Clone or Download Sadie
```bash
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie
```

### 2. Install Python Dependencies
```bash
pip install -r requirements.txt
```

Or install in development mode:
```bash
pip install -e .
```

### 3. Configure Sadie
Edit `config/config.yaml` to customize:
- Ollama URL and model
- n8n webhook URL
- Module settings
- Safety restrictions
- UI preferences

### 4. Start Required Services

#### Start Ollama (must be running)
```bash
ollama serve
```

#### Start n8n (optional)
```bash
n8n start
```

Then import the workflow:
1. Open n8n at http://localhost:5678
2. Import `src/sadie/n8n_workflows/sadie_workflow.json`
3. Activate the workflow

### 5. Run Sadie

#### GUI Mode (Default)
```bash
python -m sadie.main
```

Or if installed:
```bash
sadie
```

#### CLI Mode
```bash
python -m sadie.main --cli
```

#### Single Message
```bash
python -m sadie.main --message "What can you help me with?"
```

#### Check Status
```bash
python -m sadie.main --status
```

## Verification

Test your installation:

1. Check Ollama connection:
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. Check Sadie status:
   ```bash
   python -m sadie.main --status
   ```

3. Test with a simple message:
   ```bash
   python -m sadie.main --message "Hello Sadie"
   ```

## Troubleshooting

### Ollama not connecting
- Ensure Ollama is running: `ollama serve`
- Check URL in config.yaml matches Ollama address
- Verify models are pulled: `ollama list`

### Vision module errors
- Install Tesseract OCR and add to PATH
- Pull LLaVA model: `ollama pull llava`

### Voice module errors
- Install ffmpeg
- Check microphone permissions
- Whisper model downloads automatically on first use

### n8n connection issues
- Ensure n8n is running
- Check webhook URL in config.yaml
- Import and activate the workflow

### UI not showing
- Check PyQt5 installation: `pip install pyqt5`
- On Linux, may need: `apt-get install python3-pyqt5`

## Next Steps

See [USAGE.md](USAGE.md) for how to use Sadie.
