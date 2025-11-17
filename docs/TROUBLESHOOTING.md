# Troubleshooting Guide

## Common Issues and Solutions

### Ollama Connection Issues

#### Problem: "Failed to connect to Ollama"

**Solutions:**

1. **Check if Ollama is running:**
   ```bash
   ollama list
   ```
   If this fails, Ollama isn't running.

2. **Start Ollama:**
   ```bash
   ollama serve
   ```

3. **Verify models are installed:**
   ```bash
   ollama list
   ```
   Should show `llama2` and optionally `llava` for vision.

4. **Pull missing models:**
   ```bash
   ollama pull llama2
   ollama pull llava
   ```

5. **Check Ollama URL in config:**
   Edit `config/config.yaml` and ensure:
   ```yaml
   ollama:
     url: "http://localhost:11434"
   ```

6. **Test Ollama directly:**
   ```bash
   curl http://localhost:11434/api/tags
   ```

### Vision Module Issues

#### Problem: "LLaVA model not found"

**Solution:**
```bash
ollama pull llava
```

#### Problem: "Tesseract not found" or "pytesseract.pytesseract.TesseractNotFoundError"

**Solutions:**

1. **Install Tesseract:**
   - Windows: Download from [UB-Mannheim](https://github.com/UB-Mannheim/tesseract/wiki)
   - Install to default location or note custom path

2. **Add Tesseract to PATH:**
   - Windows: Add `C:\Program Files\Tesseract-OCR` to system PATH
   - Or set in Python:
     ```python
     import pytesseract
     pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
     ```

3. **Verify installation:**
   ```bash
   tesseract --version
   ```

#### Problem: "OCR produces gibberish"

**Solutions:**
- Ensure image quality is good
- Check language setting in config:
  ```yaml
  vision:
    ocr_language: "eng"  # or your language code
  ```
- Install additional language packs for Tesseract

### Voice Module Issues

#### Problem: "Whisper model download fails"

**Solutions:**

1. **Check internet connection** - First time needs to download model
2. **Try smaller model:**
   Edit config.yaml:
   ```yaml
   voice:
     whisper_model: "tiny"  # Smaller, faster
   ```

3. **Manual download:**
   ```python
   import whisper
   whisper.load_model("base")
   ```

#### Problem: "No microphone detected"

**Solutions:**
1. Check microphone permissions in Windows Settings
2. Test microphone with Sound Recorder
3. Verify audio device:
   ```python
   import sounddevice as sd
   print(sd.query_devices())
   ```

#### Problem: "ffmpeg not found"

**Solution:**
1. Download ffmpeg from https://ffmpeg.org/download.html
2. Add to system PATH
3. Restart terminal/application

### UI/Widget Issues

#### Problem: "Widget doesn't appear"

**Solutions:**

1. **Check PyQt5 installation:**
   ```bash
   pip install --upgrade pyqt5
   ```

2. **On Windows, try:**
   ```bash
   pip uninstall pyqt5
   pip install pyqt5
   ```

3. **Check display settings:**
   - Widget might be off-screen if you changed monitor setup
   - Try: Ctrl + Drag to move window

4. **Run in CLI mode as alternative:**
   ```bash
   python -m sadie.main --cli
   ```

#### Problem: "Widget is transparent/invisible"

**Solution:**
Edit config.yaml:
```yaml
ui:
  transparency: 1.0  # Fully opaque
```

### File Access Issues

#### Problem: "Access denied" for file operations

**Solutions:**

1. **Check file permissions:**
   - Right-click file → Properties → Security
   - Ensure your user has read/write permissions

2. **Use full paths:**
   ```
   C:\Users\YourName\Documents\file.txt
   ```
   Not relative paths like `file.txt`

3. **Check safe directories:**
   Edit config.yaml to allow access:
   ```yaml
   file_actions:
     safe_directories:
       - "Documents"
       - "Downloads"
       - "Desktop"
   ```

4. **Avoid system directories:**
   Sadie blocks access to Windows, System32, etc. for safety

#### Problem: "File not found"

**Solutions:**
- Use absolute paths
- Check file exists: `dir` command or File Explorer
- Check for typos in path
- Use forward slashes `/` or escaped backslashes `\\`

### Memory/Database Issues

#### Problem: "Database is locked"

**Solution:**
1. Close all Sadie instances
2. Delete lock file: `~/.sadie/*.db-journal`
3. Restart Sadie

#### Problem: "Memory not persisting"

**Solutions:**
1. Check memory module is enabled in config
2. Verify database file exists: `~/.sadie/sadie_memory.db`
3. Check disk space
4. Check write permissions on `.sadie` directory

### n8n Integration Issues

#### Problem: "n8n webhook not responding"

**Solutions:**

1. **Check if n8n is running:**
   ```bash
   # If installed globally
   n8n start
   
   # Or with Docker
   docker ps | grep n8n
   ```

2. **Verify webhook URL:**
   Check config.yaml:
   ```yaml
   n8n:
     url: "http://localhost:5678"
     webhook_path: "/webhook/sadie"
   ```

3. **Import workflow:**
   - Open http://localhost:5678
   - Import `src/sadie/n8n_workflows/sadie_workflow.json`
   - Activate the workflow

4. **Test webhook:**
   ```bash
   curl -X POST http://localhost:5678/webhook/sadie \
     -H "Content-Type: application/json" \
     -d '{"type":"query","query":"test"}'
   ```

### Performance Issues

#### Problem: "Sadie is slow to respond"

**Solutions:**

1. **Use faster Ollama model:**
   ```yaml
   ollama:
     model: "llama2"  # Faster than larger models
   ```

2. **Increase timeout:**
   ```yaml
   ollama:
     timeout: 60  # Increase if responses cut off
   ```

3. **Close other applications** to free up resources

4. **Check GPU usage:**
   - Ollama uses GPU if available
   - Update GPU drivers

5. **Use smaller Whisper model:**
   ```yaml
   voice:
     whisper_model: "tiny"  # Fastest option
   ```

### Installation Issues

#### Problem: "pip install fails"

**Solutions:**

1. **Update pip:**
   ```bash
   python -m pip install --upgrade pip
   ```

2. **Install dependencies one by one:**
   ```bash
   pip install pyqt5
   pip install requests
   # etc.
   ```

3. **Use virtual environment:**
   ```bash
   python -m venv venv
   venv\Scripts\activate  # Windows
   pip install -r requirements.txt
   ```

4. **Try with --user flag:**
   ```bash
   pip install --user -r requirements.txt
   ```

#### Problem: "Module not found" when running

**Solutions:**

1. **Install in development mode:**
   ```bash
   pip install -e .
   ```

2. **Or run from src directory:**
   ```bash
   cd src
   python -m sadie.main
   ```

3. **Check Python path:**
   ```python
   import sys
   print(sys.path)
   ```

### Configuration Issues

#### Problem: "Config file not found"

**Solutions:**

1. **Verify file location:**
   Should be at `config/config.yaml`

2. **Specify config path:**
   ```bash
   python -m sadie.main --config /path/to/config.yaml
   ```

3. **Check file permissions:**
   Config file must be readable

#### Problem: "Invalid configuration"

**Solutions:**
1. Validate YAML syntax online: yamllint.com
2. Check for tabs (YAML uses spaces only)
3. Ensure proper indentation
4. Restore from backup or recreate

## Getting More Help

If none of these solutions work:

1. **Check logs:**
   - Look for error messages in terminal
   - Enable debug logging if available

2. **Test components individually:**
   ```bash
   python -m sadie.main --status
   ```

3. **Minimal test:**
   ```bash
   python -m sadie.main --message "Hello"
   ```

4. **Create issue on GitHub:**
   - Include error messages
   - Include `--status` output
   - Describe what you tried
   - Include OS version and Python version

5. **Check documentation:**
   - [Installation Guide](INSTALLATION.md)
   - [Usage Guide](USAGE.md)
   - [API Documentation](API.md)

## Diagnostic Commands

Run these to gather diagnostic information:

```bash
# Python version
python --version

# Installed packages
pip list | grep -E "pyqt5|requests|pillow|whisper"

# Ollama status
ollama list

# Tesseract version
tesseract --version

# Sadie status
python -m sadie.main --status

# Quick test
python -m sadie.main --message "test"
```
