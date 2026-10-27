# HomeBot Demo Script (~10 minutes)

## Pre-Demo Warm-Up (15-20 min before)

_Merged from the former `DEMO_DAY_CHECKLIST.md` (2026-10-21)._

### 1. System Check

- [ ] Close Spotify, Discord, browser tabs, anything eating RAM/VRAM
- [ ] Plug in charger (Ollama + Electron are power-hungry)
- [ ] Check available RAM: need 8+ GB free
- [ ] Set display to single monitor or mirror (avoid fumbling with projector)

### 2. Ollama Models

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

### 3. Docker / n8n

```powershell
# Check containers
docker ps

# If homebot-n8n is not running:
docker start homebot-n8n

# IMPORTANT: Stop Docker Ollama (it conflicts with native Ollama on port 11434)
docker stop homebot-ollama
```

Verify n8n is accessible: open http://localhost:5678 in browser.

### 4. Launch HomeBot

```powershell
cd widget
npx electron-vite dev
```

Wait for the window to appear with "Hello! I'm HomeBot" greeting.

### 5. Quick Feature Verification (5 min)

Run through each tab quickly:

- [ ] **Chat**: Type "hi" — get a response (confirms Ollama connection)
- [ ] **Web**: Fetch any URL — see preview (confirms fetch_page_content works)
- [ ] **Automations**: Check existing automations show up (confirms n8n connection)
- [ ] **Image**: Check the tab loads (don't generate yet — save for demo)
- [ ] **Documents**: Check the tab loads, drag a test file
- [ ] **Quiz**: Check the tab loads
- [ ] **Media Studio**: Check the tab loads, verify episode showcase, and check movie engine project discovery
- [ ] **Voice**: Check microphone icon appears
- [ ] **Settings**: Verify qwen2.5:7b is selected as chat model

### 6. Prep Materials

- [ ] Have a PDF or DOCX file on Desktop for document viewer demo
- [ ] Have the Wikipedia AI article URL bookmarked: `https://en.wikipedia.org/wiki/Artificial_intelligence`
- [ ] Have n8n dashboard tab open: `http://localhost:5678`
- [ ] Have this script open on a second device or printed
- [ ] Have a backup URL ready (e.g. https://en.wikipedia.org/wiki/Artificial_intelligence)

---

## Act 1: Chat + Offline AI (2 min)

**Goal:** Show HomeBot works fully offline with local LLMs.

1. Type: "What's the weather in Tauranga?"
   - Shows tool-calling: the LLM invokes `get_weather` tool automatically
   - Point out the tool badge in the response

2. Type: "Create a folder called demo-test on my Desktop"
   - Shows filesystem agency: creates a real folder
   - Open File Explorer to verify

3. Type: "What files are on my Desktop?"
   - Shows `list_directory` tool
   - Verify demo-test folder appears in the list

**Talking point:** "All of this runs offline on your local machine. No data leaves the device."

---

## Act 2: Web Browser + Summarizer (2 min)

**Goal:** Show web page fetch, summarize, and RAG indexing.

1. Click the **Web** tab in the sidebar
2. Paste URL: `https://en.wikipedia.org/wiki/Artificial_intelligence`
3. Click **Fetch** - show the preview with character count
4. Click **Summarize in Chat** - watch it switch to chat and the AI summarizes the page
5. Go back to Web tab, click **Add to RAG** - show "Indexed into RAG (X chunks)"
6. In chat, type: "What does my RAG index say about machine learning?"
   - Shows semantic search over the indexed page

**Talking point:** "You can fetch any web page, get an AI summary, or index it for later retrieval."

---

## Act 3: Automation Center + n8n (2 min)

**Goal:** Show real n8n workflow deployment and execution.

1. Click the **Automations** tab
2. Click **+ New Automation**
3. Name: "Daily Digest"
4. Description: "Summarize the top news headlines"
5. Toggle **Deploy to n8n** ON
6. Click **Create**
   - Show the status badge turning green (DEPLOYED)
   - Open n8n dashboard (localhost:5678) in browser to show the workflow exists
7. Click the **Run** button on the automation
   - Show the webhook being called and the response streaming back

**Talking point:** "One click deploys a real n8n workflow with webhook trigger, Ollama integration, and response formatting."

---

## Act 4: Image Generation (1 min)

**Goal:** Show multi-backend image generation.

1. Click the **Image** tab
2. Type prompt: "A cozy home office with a cat sleeping on the desk, digital art"
3. Set style to "Realistic", resolution to "512x512"
4. Set backend to "Hybrid (local)" — will try local SD first, then cloud
5. Click **Generate Image**
6. If local SD isn't running, it auto-falls back to Pollinations (free cloud)
7. Show the generated image

**Talking point:** "HomeBot tries 5 backends automatically. Local Stable Diffusion first, then free cloud services. No API key needed."

---

## Act 5: Document Viewer + RAG (1 min)

**Goal:** Show document parsing and RAG integration.

1. Click the **Documents** tab
2. Drag and drop a PDF or DOCX file (have one ready)
3. Show the parsed content preview
4. Click **Add to RAG** - index it
5. Switch to chat, ask a question about the document content

**Talking point:** "Supports PDF, DOCX, Excel, code files. Index anything into RAG for semantic search."

---

## Act 6: Quiz Mode (1 min)

**Goal:** Show AI-generated quizzes from any topic.

1. Click the **Quiz** tab
2. Select topic: "JavaScript" (or any)
3. Select difficulty: "Medium"
4. Click **Generate Quiz**
5. Answer 2-3 questions, show instant feedback
6. Show the results screen with score and streak

**Talking point:** "The AI generates unique questions every time using Ollama. Great for studying."

---

## Act 7: Voice Conversation (30 sec)

**Goal:** Show TTS/STT integration.

1. Click the **Voice** tab
2. Click the microphone button
3. Say: "Tell me a fun fact about New Zealand"
4. Show the transcription appearing, then the AI speaking the response

**Talking point:** "Speech-to-text runs local Whisper offline. Text-to-speech uses Edge neural voices."

---

## Act 8: Security + Architecture (30 sec)

**Goal:** Show security is real, not just claims.

1. In chat, type: "Read the file C:\Windows\System32\config\SAM"
   - Shows permission gating: tool requires explicit approval
   - Deny the permission request
2. Mention: "11 security layers including IPC allowlisting, SSRF protection, context isolation, and recursion caps"

**Talking point:** "Every sensitive action requires explicit user permission. The app can't access files outside your home directory without asking."

---

## Closing (30 sec)

- Show the Settings panel briefly (model selector, cloud API config, themes)
- Mention the current figures from [Numbers to Remember](#numbers-to-remember) (re-verify against the codebase before quoting)
- Show light/dark theme toggle
- "HomeBot: privacy-first, offline-capable, genuinely agentic"

---

## If Something Goes Wrong

| Problem | Quick Fix |
|---------|-----------|
| Ollama not responding | `ollama serve` in terminal |
| n8n not running | `docker start homebot-n8n` |
| No models showing | `ollama pull qwen2.5:7b` |
| App won't start | `cd widget && npm run build && npx electron-vite dev` |
| Image gen fails | Backend auto-fallback handles this; if all fail, skip this act or show the code in web.ts explaining the 5-backend fallback |
| Voice not working | Skip to quiz mode; mention local Whisper transcription |
| Chat is very slow | Switch to a smaller model in Settings (gemma4:e4b) |
| n8n is down | Demo the automation without deploy (local fallback runs instead) |
| Port 11434 conflict | `docker stop homebot-ollama` then `ollama serve` |

## Numbers to Remember

Product facts verified from the codebase — useful when a prospect asks:

| Metric | Value |
|--------|-------|
| Tool handlers | 137 across 35 modules |
| Security layers | 11 |
| Cloud providers | 10 |
| Image gen backends | 5 |
| Movie gen providers | 5 (Local Parallax, Colab SDXL IP-Adapter, Local SD 1.5, Pollinations, Imagen 3) |
| Application modes | 11 |
| Automated tests | ~3,700+ across 250+ suites |
| Ollama models used | qwen2.5:7b, qwen2.5-coder:7b, nomic-embed-text |
