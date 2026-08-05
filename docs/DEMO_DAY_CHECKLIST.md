# Pre-Demo Warm-Up Checklist

Run through this 15-20 minutes before a customer or investor demo.

## 1. System Check

- [ ] Close Spotify, Discord, browser tabs, anything eating RAM/VRAM
- [ ] Plug in charger (Ollama + Electron are power-hungry)
- [ ] Check available RAM: need 8+ GB free
- [ ] Set display to single monitor or mirror (avoid fumbling with projector)

## 2. Ollama Models

```powershell
# Verify Ollama is running and has models
ollama list
```

Expected output should show:
- `qwen2.5:7b` (main chat model)
- `nomic-embed-text` (RAG embeddings)
- `qwen2.5-coder:7b` (optional, for MoA)

If models are missing:
```powershell
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

**Pre-warm the model** (loads it into VRAM so first chat is instant):
```powershell
curl http://localhost:11434/api/generate -d "{\"model\":\"qwen2.5:7b\",\"prompt\":\"hello\",\"stream\":false}"
```

## 3. Docker / n8n

```powershell
# Check containers
docker ps

# If homebot-n8n is not running:
docker start homebot-n8n

# IMPORTANT: Stop Docker Ollama (it conflicts with native Ollama on port 11434)
docker stop homebot-ollama
```

Verify n8n is accessible: open http://localhost:5678 in browser.

## 4. Launch HomeBot

```powershell
cd widget
npx electron-vite dev
```

Wait for the window to appear with "Hello! I'm HomeBot" greeting.

## 5. Quick Feature Verification (5 min)

Run through each tab quickly:

- [ ] **Chat**: Type "hi" — get a response (confirms Ollama connection)
- [ ] **Web**: Fetch any URL — see preview (confirms fetch_page_content works)
- [ ] **Automations**: Check existing automations show up (confirms n8n connection)
- [ ] **Image**: Check the tab loads (don't generate yet — save for demo)
- [ ] **Documents**: Check the tab loads, drag a test file
- [ ] **Quiz**: Check the tab loads
- [ ] **Voice**: Check microphone icon appears
- [ ] **Settings**: Verify qwen2.5:7b is selected as chat model

## 6. Prep Materials

- [ ] Have a PDF or DOCX file on Desktop for document viewer demo
- [ ] Have the Wikipedia AI article URL bookmarked: `https://en.wikipedia.org/wiki/Artificial_intelligence`
- [ ] Have n8n dashboard tab open: `http://localhost:5678`
- [ ] Have DEMO_SCRIPT.md open on a second device or printed

## 7. Backup Plans

| If this fails... | Do this instead... |
|---|---|
| Ollama won't start | Run `ollama serve` manually in PowerShell |
| Chat is very slow | Switch to a smaller model in Settings (gemma4:e4b) |
| n8n is down | Demo the automation without deploy (local fallback runs instead) |
| Image gen fails | Show the code in web.ts explaining 5-backend fallback |
| Voice doesn't work | Skip voice, mention local Whisper transcription instead |
| App crashes on start | Run `npm run build` first, then `npx electron-vite dev` |
| Port 11434 conflict | `docker stop homebot-ollama` then `ollama serve` |

## 8. Numbers to Remember

Product facts verified from the codebase — useful when a prospect asks:

| Metric | Value |
|--------|-------|
| Tool handlers | 85+ across 27 modules |
| Security layers | 11 |
| Cloud providers | 10 |
| Image gen backends | 5 |
| Automated tests | 1,932 across 122 suites |
| Ollama models used | qwen2.5:7b, qwen2.5-coder:7b, nomic-embed-text |
