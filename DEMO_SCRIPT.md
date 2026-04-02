# SADIE Demo Script

## Demo Overview

This script provides a step-by-step demonstration of SADIE's core features and capabilities. The demo showcases the application's AI tool system, security features, and user experience.

## Prerequisites

- SADIE application installed and running
- Ollama running with `llama3.2:3b` and `llava:latest` models pulled
- Internet connection for web-based tools
- Sample documents and images (optional) for document / vision demos

## Demo Script

### 1. Application Launch & First Run Experience

**Narrator:** "Let's start by launching SADIE for the first time."

**Actions:**
1. Launch the SADIE application
2. Observe the first-run modal appears
3. Review the welcome message and feature overview
4. Click "Get Started" to enter the main interface

**Expected Outcome:**
- Clean, professional interface loads
- First-run modal provides clear onboarding
- Telemetry settings are presented for user choice

---

### 2. Interface Overview

**Narrator:** "SADIE provides a clean, intuitive interface for AI interactions."

**Actions:**
1. Point out the main chat interface
2. Show the settings panel (gear icon)
3. Demonstrate the telemetry toggle
4. Explain the structured tool-based approach

**Key Features to Highlight:**
- Futuristic UI with neon glows, animated avatars, and glass morphism
- Light / dark / system theme toggle in settings
- Settings accessible but not intrusive
- Privacy controls prominently displayed
- Conversation sidebar with timestamps and message count badges

---

### 3. Web Search Capability

**Narrator:** "One of SADIE's core features is intelligent web search with automatic content fetching."

**Demo Query:** "What are the current standings in the NBA Eastern Conference?"

**Actions:**
1. Type the query in the chat interface
2. Show how SADIE automatically searches and fetches content
3. Demonstrate the structured response format
4. Point out the source attribution and content preview

**Expected Outcome:**
- Fast search results from multiple engines
- Automatic content fetching from top results
- Clean, readable response format
- Source links provided for verification

---

### 4. Weather Information Tool

**Narrator:** "SADIE can provide real-time weather information without requiring API keys."

**Demo Query:** "What's the weather like in New York City?"

**Actions:**
1. Enter the weather query
2. Show the formatted weather response
3. Highlight the comprehensive data provided
4. Note that no external API keys are required

**Expected Outcome:**
- Current temperature, conditions, and forecast
- Wind speed, humidity, and visibility data
- Location validation and error handling

---

### 5. URL Content Fetching

**Narrator:** "For specific web pages, SADIE can extract and summarize content safely."

**Demo Query:** "Can you summarize the main points from https://en.wikipedia.org/wiki/Artificial_intelligence?"

**Actions:**
1. Provide a URL for content extraction
2. Demonstrate safe URL validation
3. Show content extraction and summarization
4. Highlight security measures preventing unsafe URLs

**Expected Outcome:**
- Safe URL validation prevents malicious links
- Clean text extraction from HTML
- Intelligent content summarization
- Error handling for inaccessible content

---

### 6. Vision & Image Analysis

**Narrator:** "SADIE can understand images using local AI models."

**Demo Actions:**
1. Attach a screenshot or photo to the chat
2. Ask: "What's in this image?"
3. Show how SADIE uses `vision_describe` to analyze the image via LLaVA
4. Follow up with a specific question: "What text is visible in the image?"
5. Show inline image thumbnails in the chat bubble

**Expected Outcome:**
- Detailed image description (colours, objects, text, layout)
- Specific answers to image queries
- Image thumbnails rendered inline in user messages
- All processing happens locally via Ollama LLaVA

---

### 7. RAG Document Search

**Narrator:** "SADIE can index your documents and search them semantically."

**Demo Actions:**
1. Click the 📎 RAG index button in the input toolbar
2. Select a PDF or code file to index
3. Show the "⏳ indexing…" spinner and "✅ Indexed" confirmation
4. Ask: "What does the document say about [topic]?"
5. Alternatively, drag-and-drop a file onto the chat input area

**Expected Outcome:**
- File indexed with TF-IDF cosine similarity
- Semantic search returns relevant excerpts ranked by relevance
- Works offline with no model download required
- Low-confidence results flagged appropriately

---

### 8. Image Generation

**Narrator:** "SADIE can generate images from text descriptions."

**Demo Query:** "Generate an image of a futuristic city at sunset"

**Actions:**
1. Enter the image generation request
2. Show the "⏳ Generating image, please wait…" progress indicator
3. Image appears inline in the chat
4. Explain the fallback cascade: Pollinations.ai → Stable Horde

**Expected Outcome:**
- Progress indicator shown during generation
- Image rendered inline in assistant message
- Free API with optional Stable Horde key for faster generation

---

### 9. Theme & UI Customization

**Narrator:** "SADIE supports multiple themes and futuristic visual effects."

**Demo Actions:**
1. Open settings panel
2. Switch between Light / Dark / System themes
3. Point out animated elements: header scan line, avatar glow rings, message slide-in
4. Show glass morphism effects on settings panel
5. Demonstrate the ⚡ user avatar with its gradient and spinning ring

**Expected Outcome:**
- Smooth theme transitions
- Consistent styling across all components
- Reduced-motion accessibility mode for users who prefer it

---

### 10. Embedded Web Services

**Narrator:** "SADIE gives you access to ChatGPT, Claude, and Gemini directly in-app."

**Demo Actions:**
1. Open the web services panel
2. Show the three available services
3. Click to open one in a sandboxed browser panel
4. Demonstrate that it works with your existing subscription

**Expected Outcome:**
- Sandboxed BrowserWindow with correct Chrome UA
- Cloudflare bot-detection bypassed
- Login and interaction works normally
- Services isolated from SADIE's main functionality

---

### 11. Code Cloud API

**Narrator:** "For complex coding tasks, SADIE can route to cloud LLMs."

**Demo Actions:**
1. Open settings → Code Model — Cloud API section
2. Show provider options: OpenAI / Anthropic / OpenRouter / Custom
3. Enter an API key (optional demo)
4. Ask a coding question: "Write a Python function to sort a list"
5. Show how it routes to the cloud model if configured

**Expected Outcome:**
- Coding queries automatically routed to cloud model when configured
- Falls back to local Ollama when no cloud key is set
- Code blocks rendered with syntax highlighting and copy button

---

### 12. Error Handling & Safety

**Narrator:** "SADIE includes comprehensive error handling and security measures."

**Demo Actions:**
1. Try an invalid URL to show safety validation
2. Demonstrate graceful error handling
3. Show appropriate error messages
4. Highlight security boundaries

**Expected Outcome:**
- Clear, helpful error messages
- Safe handling of invalid inputs
- No crashes or security vulnerabilities
- User-friendly error recovery

---

### 13. Settings & Privacy Controls

**Narrator:** "User privacy and control are core to SADIE's design."

**Demo Actions:**
1. Open settings panel
2. Show telemetry controls
3. Demonstrate preference persistence
4. Explain data handling practices

**Expected Outcome:**
- Clear privacy controls
- User choice in data collection
- Settings persistence across sessions
- Transparent data practices

---

### 14. Global Hotkey & Auto-Update

**Narrator:** "SADIE integrates seamlessly into your workflow."

**Demo Actions:**
1. Minimize SADIE
2. Press `Ctrl+Shift+Space` to instantly toggle SADIE back
3. Show the auto-update notification (if an update is available)
4. Explain that updates are downloaded in the background

**Expected Outcome:**
- Instant toggle from any application
- Seamless update experience
- No manual download required

---

### 15. Closing & Key Takeaways

**Narrator:** "SADIE represents a new approach to AI assistants - secure, private, and capable."

**Key Points to Emphasize:**
- **Security First**: SSRF protection, IPC hardening, webhook auth, tool recursion cap
- **Privacy Focused**: User controls over data and telemetry, offline-first
- **AI-Powered**: Vision, RAG, image generation, planning, 20+ tool handlers
- **Extensible Architecture**: Tool-based system, cloud API routing, embedded web services
- **Modern UI**: Light/dark/system themes, futuristic animations, glass morphism
- **Developer Quality**: 87 test suites / 1339 unit tests, TypeScript strict mode
- **Global Hotkey**: Ctrl+Shift+Space for instant access
- **Auto-Update**: Seamless electron-updater integration

---

## Demo Preparation Checklist

### Pre-Demo Setup
- [ ] Verify SADIE builds and runs correctly
- [ ] Ollama running with `llama3.2:3b` and `llava:latest`
- [ ] Test all demo queries in advance
- [ ] Ensure internet connection is stable
- [ ] Prepare sample images for vision demo
- [ ] Prepare sample documents for RAG demo
- [ ] Clear any cached data for fresh demonstration

### Demo Environment
- [ ] Clean SADIE installation (no cached data)
- [ ] Stable internet connection
- [ ] External display or screen sharing setup
- [ ] Backup demo queries ready

### Contingency Plans
- [ ] Alternative queries if web content changes
- [ ] Offline demo capabilities if internet fails
- [ ] Error recovery procedures
- [ ] Backup demonstration methods

## Technical Notes for Demo

### Build Verification
- Ensure production build is clean (no forbidden strings)
- Verify all preflight checks pass
- Confirm telemetry settings work correctly
- Test first-run experience

### Performance Expectations
- Web search: 2-5 seconds response time
- Weather queries: <1 second response time
- Vision analysis: 5-15 seconds (depends on image size)
- Image generation: 10-120 seconds (depends on Stable Horde queue)
- RAG indexing: 1-5 seconds per document
- UI interactions: Instantaneous with smooth animations
- Memory usage: <200MB typical operation

### Security Demonstrations
- Show URL validation prevents localhost access
- Demonstrate safe error handling
- Highlight context isolation benefits
- Explain compile-time security measures

## Demo Success Metrics

- [ ] All features demonstrate correctly
- [ ] No errors or crashes during demo
- [ ] Clear explanation of security features
- [ ] Positive user experience impressions
- [ ] Questions about architecture and implementation answered

This demo script ensures a comprehensive showcase of SADIE's capabilities while highlighting its security, performance, and user experience strengths.