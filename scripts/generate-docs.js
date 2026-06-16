/**
 * Generate SADIE Poster and Project Report as .docx files
 * Run: node scripts/generate-docs.js
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageBreak, TabStopPosition, TabStopType, Header, Footer,
  TableOfContents, StyleLevel
} = require(require('path').resolve(__dirname, '..', 'widget', 'node_modules', 'docx'));
const fs = require('fs');
const path = require('path');

// ── Shared constants ──────────────────────────────────────────────────────
const STUDENT = 'Aden Kingi';
const INSTITUTION = 'Toi Ohomai Institute of Technology';
const PROGRAMME = 'Bachelor of Computing Systems (Level 7)';
const PROJECT = 'SADIE — Structured AI Desktop Intelligence Engine';
const YEAR = '2026';
const SUPERVISOR = 'Francisco Roldao';

const BLUE = '2563EB';
const DARK = '1E293B';
const GRAY = '64748B';
const LIGHT_BG = 'F1F5F9';

// ── Helper factories ──────────────────────────────────────────────────────
function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 300, after: 120 } });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    ...opts,
    children: [new TextRun({ text, size: 22, font: 'Calibri', ...opts })]
  });
}

function bold(text) {
  return new TextRun({ text, bold: true, size: 22, font: 'Calibri' });
}

function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 60, line: 276 },
    children: [new TextRun({ text, size: 22, font: 'Calibri' })]
  });
}

function tableRow(cells, header = false) {
  return new TableRow({
    children: cells.map(text => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text, bold: header, size: 20, font: 'Calibri' })],
        spacing: { before: 40, after: 40 }
      })],
      shading: header ? { type: ShadingType.SOLID, color: BLUE, fill: BLUE } : undefined,
      ...(header ? {} : {}),
    })),
    tableHeader: header,
  });
}

function simpleTable(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      tableRow(headers, true),
      ...rows.map(r => tableRow(r))
    ]
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 200 }, children: [] });
}

// ══════════════════════════════════════════════════════════════════════════
// POSTER
// ══════════════════════════════════════════════════════════════════════════
function buildPoster() {
  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } }
      }
    },
    sections: [{
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } }
      },
      children: [
        // Title
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: 'SADIE', size: 56, bold: true, font: 'Calibri', color: BLUE })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: 'Structured AI Desktop Intelligence Engine', size: 28, font: 'Calibri', color: DARK })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: `${STUDENT}  •  ${INSTITUTION}  •  ${PROGRAMME}`, size: 20, font: 'Calibri', color: GRAY })]
        }),

        // Problem
        heading('The Problem', HeadingLevel.HEADING_2),
        body('Cloud-based AI assistants require an internet connection and send every conversation to a remote server. Users who need AI assistance for sensitive work — personal documents, business data, local system administration — are forced to choose between capability and privacy. No existing desktop tool offers a fully offline AI assistant with broad tool integration and agentic multi-step reasoning.'),

        // Solution
        heading('SADIE — The Solution', HeadingLevel.HEADING_2),
        body('SADIE is a privacy-first desktop AI assistant built with Electron 28, React 18, and TypeScript. It runs entirely on the user\'s machine using Ollama for local LLM inference, with optional cloud provider support when the user explicitly enables it. SADIE combines a rich chat interface with 60+ local tool handlers, agentic multi-step reasoning, retrieval-augmented generation (RAG), and a modern glass-morphism UI — all without requiring an API key or internet connection for core functionality.'),

        // Architecture
        heading('System Architecture', HeadingLevel.HEADING_2),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: [
            '┌─────────────────────────────────────────────────┐',
            '│           Electron 28 + React 18 UI             │',
            '│   ┌──────────┐  IPC Bridge  ┌───────────────┐   │',
            '│   │ Renderer │◄────────────►│  Main Process  │   │',
            '│   │ (React)  │              │  (Node.js)     │   │',
            '│   └──────────┘              └──────┬────────┘   │',
            '│                                    │            │',
            '│   ┌────────────┐  ┌────────────┐   │            │',
            '│   │  Ollama    │  │ Cloud LLMs │   │            │',
            '│   │ (local AI) │  │ (optional) │◄──┘            │',
            '│   └────────────┘  └────────────┘                │',
            '│          85+ Tool Handlers (TypeScript)         │',
            '└─────────────────────────────────────────────────┘',
          ].join('\n'), size: 16, font: 'Consolas' })]
        }),

        // Key Features (two-column via table)
        heading('Key Features', HeadingLevel.HEADING_2),
        simpleTable(
          ['Capability', 'Description'],
          [
            ['Web Search', 'Multi-engine cascade (Tavily, Serper, DuckDuckGo, Google, Brave) with content fetching and SSRF protection'],
            ['File Manager', 'Read, write, move, delete files with path validation and directory whitelisting'],
            ['Vision / OCR', 'Describe images and extract text via Ollama moondream model'],
            ['RAG Engine', 'Drag-and-drop document indexing with hybrid TF-IDF + semantic embedding search'],
            ['Agentic Loops', 'LLM autonomously chains tools for multi-step requests with streaming progress'],
            ['Cloud LLM Routing', '11 providers: OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, OpenRouter, and more'],
            ['Mixture of Agents', 'Multiple local models propose answers; an aggregator synthesises the best response'],
            ['Morning Briefing', 'Proactive daily summary of weather, calendar, and reminders'],
            ['Quiz Mode', 'Interactive coding quizzes with 12 topics, 3 difficulty levels, and persistent progress tracking'],
            ['Automation Center', 'Create, edit, and run reusable automations with manual or scheduled triggers'],
            ['85+ Tools', 'Code runner, NBA scores, image generation, Git, terminal, email, calendar, and more'],
          ]
        ),
        spacer(),

        // Technology Stack
        heading('Technology Stack', HeadingLevel.HEADING_2),
        simpleTable(
          ['Layer', 'Technology'],
          [
            ['Desktop Shell', 'Electron 28 with context isolation and preload bridge'],
            ['Frontend', 'React 18, TypeScript, Tailwind CSS, glass-morphism UI'],
            ['LLM Inference', 'Ollama (offline) + 11 cloud providers (optional)'],
            ['Embeddings', 'nomic-embed-text via Ollama for RAG and memory'],
            ['Testing', 'Jest (120 test suites) + Playwright (E2E)'],
            ['Build', 'electron-vite, electron-builder (NSIS installer)'],
            ['Orchestration', 'n8n (optional Docker container for scheduled workflows)'],
          ]
        ),
        spacer(),

        // Testing and Results
        heading('Testing & Results', HeadingLevel.HEADING_2),
        bullet('120 test suites — all passing'),
        bullet('~55,000 lines of TypeScript across 409 tracked files'),
        bullet('398 commits over the development lifecycle'),
        bullet('Playwright E2E tests for critical user flows'),
        bullet('SSRF protection, IPC hardening, webhook auth, tool recursion cap'),
        bullet('Runs comfortably on a laptop with 4 GB+ GPU VRAM'),

        // Future Work
        heading('Future Work', HeadingLevel.HEADING_2),
        bullet('Plugin system for community-contributed tool handlers'),
        bullet('Multi-user support with per-user encrypted memory stores'),
        bullet('Mobile companion app for remote access to the local SADIE instance'),
        bullet('Fine-tuned local models optimised for SADIE\'s tool-calling schema'),
      ]
    }]
  });
}

// ══════════════════════════════════════════════════════════════════════════
// PROJECT REPORT
// ══════════════════════════════════════════════════════════════════════════
function buildReport() {
  const children = [];

  // ── Title page ──
  for (let i = 0; i < 6; i++) children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'SADIE', size: 72, bold: true, font: 'Calibri', color: BLUE })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Structured AI Desktop Intelligence Engine', size: 32, font: 'Calibri', color: DARK })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Capstone Project Report', size: 28, font: 'Calibri' })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: PROGRAMME, size: 24, font: 'Calibri', color: GRAY })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: INSTITUTION, size: 24, font: 'Calibri', color: GRAY })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Student: ${STUDENT}`, size: 24, font: 'Calibri' })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: `Date: June ${YEAR}`, size: 24, font: 'Calibri', color: GRAY })]
  }));

  // Page break after title
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Abstract ──
  children.push(heading('Abstract'));
  children.push(body('This report documents the design, implementation, and evaluation of SADIE (Structured AI Desktop Intelligence Engine), a privacy-first desktop AI assistant built as a capstone project for the Bachelor of Computing Systems programme at Toi Ohomai Institute of Technology. SADIE addresses the growing tension between AI capability and data privacy by providing a fully offline-capable AI assistant that runs local large language models (LLMs) via Ollama, while optionally supporting 11 cloud LLM providers when users explicitly enable them. The application is built with Electron 28, React 18, and TypeScript, featuring 85+ locally-executed tool handlers, retrieval-augmented generation (RAG), agentic multi-step reasoning, an interactive quiz mode, an automation center, and a modern glass-morphism user interface. The system is validated by 120 test suites, Playwright end-to-end tests, and manual testing across multiple hardware profiles. SADIE demonstrates that a desktop AI assistant can match the breadth of cloud-based alternatives while keeping user data entirely local.'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 1. Introduction ──
  children.push(heading('1. Introduction'));
  children.push(heading('1.1 Background', HeadingLevel.HEADING_2));
  children.push(body('The rapid growth of large language models (LLMs) has made AI assistants a mainstream productivity tool. Services like ChatGPT, Claude, and Gemini offer powerful conversational AI with tool use, but they require sending every message to a remote server. For users handling sensitive personal documents, proprietary business data, or local system administration tasks, this creates an unacceptable privacy trade-off. Meanwhile, local LLM tools like Ollama have made it possible to run capable models on consumer hardware, but they lack the rich tool integration, polished UI, and agentic reasoning that make cloud assistants practical for real work.'));

  children.push(heading('1.2 Problem Statement', HeadingLevel.HEADING_2));
  children.push(body('No existing desktop application combines fully offline LLM inference with a broad tool ecosystem, agentic multi-step reasoning, document understanding (RAG), and a modern user experience — all in a single, installable application that respects user privacy by default.'));

  children.push(heading('1.3 Objectives', HeadingLevel.HEADING_2));
  children.push(bullet('Build a desktop AI assistant that runs entirely offline using local LLMs'));
  children.push(bullet('Implement 85+ tool handlers covering web search, file management, vision, coding, system administration, and more'));
  children.push(bullet('Support agentic multi-step reasoning where the LLM autonomously chains tools'));
  children.push(bullet('Provide retrieval-augmented generation (RAG) for document-grounded answers'));
  children.push(bullet('Offer optional cloud LLM routing to 11 providers for users who want cloud quality'));
  children.push(bullet('Deliver a polished, themeable desktop UI with accessibility and keyboard shortcuts'));
  children.push(bullet('Include an interactive quiz mode and an automation center for reusable task workflows'));
  children.push(bullet('Validate the system with comprehensive automated testing'));

  children.push(heading('1.4 Scope', HeadingLevel.HEADING_2));
  children.push(body('SADIE targets Windows 10/11 desktop users with at least 4 GB of GPU VRAM. The project covers the full stack from UI to LLM integration, tool execution, and deployment packaging. It does not cover training custom models, mobile platforms, or multi-user server deployment.'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 2. Literature Review ──
  children.push(heading('2. Literature Review'));
  children.push(heading('2.1 Local LLM Inference', HeadingLevel.HEADING_2));
  children.push(body('Ollama (ollama.com) provides a lightweight runtime for running quantised LLMs on consumer GPUs. Models like Qwen 2.5 (7B parameters, 4.7 GB VRAM) and Gemma 4 achieve strong performance on general reasoning and tool-calling benchmarks. The key enabler is GGUF quantisation, which reduces model weights to 4-bit precision with minimal quality loss, making 7B-parameter models practical on GPUs with as little as 4 GB of VRAM (Dettmers et al., 2023).'));

  children.push(heading('2.2 Tool-Augmented LLMs', HeadingLevel.HEADING_2));
  children.push(body('Tool use (also called function calling) allows LLMs to invoke external functions by generating structured JSON tool calls. This pattern, popularised by OpenAI\'s function calling API and adopted by Ollama\'s native tool calling support, enables LLMs to perform actions beyond text generation — searching the web, reading files, executing code, and controlling system resources. Schick et al. (2023) demonstrated that tool-augmented LLMs significantly outperform base models on tasks requiring external information or computation.'));

  children.push(heading('2.3 Retrieval-Augmented Generation', HeadingLevel.HEADING_2));
  children.push(body('RAG combines LLM generation with document retrieval to ground responses in specific source material. Lewis et al. (2020) showed that RAG significantly reduces hallucination by providing the model with relevant context at inference time. SADIE implements RAG using a hybrid TF-IDF and semantic embedding approach with Ollama\'s nomic-embed-text model, supporting PDF, Word, code, CSV, and Markdown documents.'));

  children.push(heading('2.4 Agentic Reasoning', HeadingLevel.HEADING_2));
  children.push(body('Agentic LLM systems allow models to autonomously plan and execute multi-step tasks by iteratively calling tools and observing results. This approach, explored by frameworks like LangChain and AutoGPT, enables complex workflows such as "search for X, save the results to a file, then email me a summary." SADIE implements agentic reasoning with a configurable tool recursion cap (MAX_TOOL_ROUNDS = 10) to prevent infinite loops.'));

  children.push(heading('2.5 Existing Solutions', HeadingLevel.HEADING_2));
  children.push(body('Existing desktop AI tools fall into two categories: (1) cloud-only wrappers like the ChatGPT desktop app, which offer a polished UI but require an internet connection and send all data to remote servers; and (2) local-only tools like LM Studio or GPT4All, which provide offline inference but lack tool integration, agentic reasoning, and document understanding. SADIE bridges this gap by combining the tool richness of cloud assistants with the privacy of local inference.'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 3. Methodology ──
  children.push(heading('3. Methodology'));
  children.push(heading('3.1 Development Approach', HeadingLevel.HEADING_2));
  children.push(body('SADIE was developed using an iterative agile methodology over approximately six months. Development was organised into phases: core architecture and chat functionality, tool handler implementation, RAG and agentic reasoning, cloud LLM integration, UI polish, and testing/deployment. Each phase produced a working increment that was tested and refined before the next phase began.'));

  children.push(heading('3.2 Technology Selection', HeadingLevel.HEADING_2));
  children.push(simpleTable(
    ['Component', 'Technology', 'Rationale'],
    [
      ['Desktop Framework', 'Electron 28', 'Cross-platform desktop apps with web technologies; mature ecosystem; context isolation for security'],
      ['Frontend', 'React 18 + TypeScript', 'Component-based UI with strong typing; large ecosystem of libraries'],
      ['Styling', 'Tailwind CSS 4', 'Utility-first CSS for rapid UI development; glass-morphism design system'],
      ['LLM Runtime', 'Ollama', 'Simple HTTP API for local model inference; supports tool calling; handles GPU memory management'],
      ['Build System', 'electron-vite + electron-builder', 'Fast development builds with HMR; production NSIS installer packaging'],
      ['Testing', 'Jest + Playwright', 'Unit testing with mocks; E2E testing with real Electron windows'],
      ['Package Manager', 'npm', 'Standard Node.js package management; lockfile for reproducible builds'],
    ]
  ));

  children.push(heading('3.3 Hardware Testing Profiles', HeadingLevel.HEADING_2));
  children.push(body('SADIE was tested across three hardware profiles to ensure broad compatibility:'));
  children.push(simpleTable(
    ['Profile', 'GPU VRAM', 'Default Chat Model', 'Default Vision Model'],
    [
      ['4 GB', '4 GB', 'qwen2.5:7b (4.7 GB)', 'moondream (1.7 GB)'],
      ['8 GB', '8 GB', 'qwen2.5:7b (4.7 GB)', 'moondream (1.7 GB)'],
      ['16 GB+', '16+ GB', 'gemma4:e4b (9.6 GB)', 'moondream (1.7 GB)'],
    ]
  ));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 4. System Design ──
  children.push(heading('4. System Design'));
  children.push(heading('4.1 Architecture Overview', HeadingLevel.HEADING_2));
  children.push(body('SADIE follows a multi-process Electron architecture with strict separation between the renderer (UI) and main (backend) processes. All LLM communication, tool execution, file I/O, and system access occurs in the main process. The renderer communicates exclusively through a typed preload bridge using Electron\'s contextBridge API, ensuring context isolation.'));

  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: [
      '┌──────────────────────────────────────────────────────────┐',
      '│                    Electron 28 Shell                     │',
      '│                                                          │',
      '│  ┌──────────────┐    IPC     ┌────────────────────────┐  │',
      '│  │  Renderer     │◄─────────►│  Main Process           │  │',
      '│  │  React 18 UI  │  Bridge   │  Message Router          │  │',
      '│  │  Tailwind CSS │           │  85+ Tool Handlers       │  │',
      '│  │  Glass UI     │           │  Config Manager           │  │',
      '│  └──────────────┘           │  Memory Manager           │  │',
      '│                              │  RAG Engine               │  │',
      '│                              │  Agentic Loop             │  │',
      '│                              └──────────┬───────────────┘  │',
      '│                                         │                  │',
      '│  ┌──────────────┐  ┌──────────────┐     │                  │',
      '│  │ Ollama       │  │ Cloud LLMs   │◄────┘                  │',
      '│  │ (local)      │  │ (11 providers│                        │',
      '│  │ 127.0.0.1:   │  │  optional)   │                        │',
      '│  │ 11434        │  └──────────────┘                        │',
      '│  └──────────────┘                                          │',
      '│                                                            │',
      '│  Local disk: config/ , memory/ , logs/                     │',
      '└──────────────────────────────────────────────────────────┘',
    ].join('\n'), size: 15, font: 'Consolas' })]
  }));

  children.push(heading('4.2 Message Router', HeadingLevel.HEADING_2));
  children.push(body('The message router is the central orchestration layer (~5,000 lines). It receives user messages from the renderer, determines routing (local Ollama, cloud LLM, or n8n), manages conversation history and context budgets, handles tool call extraction and execution, and streams responses back to the UI. Key features include:'));
  children.push(bullet('Intent detection for slash commands, tool-heavy queries, and simple greetings'));
  children.push(bullet('Automatic model selection based on task type (vision, coding, reasoning)'));
  children.push(bullet('Context budget scaling for small models (4K tokens) vs large models (8K+ tokens)'));
  children.push(bullet('Agentic loop with MAX_TOOL_ROUNDS = 10 to prevent infinite tool-call cycles'));
  children.push(bullet('Anti-hallucination guards: synthesis prompts, garbage output detection, web-grounding'));

  children.push(heading('4.3 Tool System', HeadingLevel.HEADING_2));
  children.push(body('SADIE registers 85+ tools at startup across 20 categories. Each tool is defined by a JSON schema (for LLM tool calling) and a TypeScript handler function. Tools execute locally in the main process and return structured JSON results. Tool categories include:'));
  children.push(simpleTable(
    ['Category', 'Tools', 'Description'],
    [
      ['File System', '8 tools', 'Read, write, edit, copy, move, delete, list, search files'],
      ['Web', '4 tools', 'Web search (5-engine cascade), fetch URL, fetch page content, get weather'],
      ['Vision', '2 tools', 'Describe image, query image with question (via Ollama moondream)'],
      ['System', '4 tools', 'System info, disk usage, running processes, current time'],
      ['Code', '2 tools', 'Run code snippets (sandboxed), analyse file structure'],
      ['Documents', '4 tools', 'Parse PDF/Word/text, create DOCX, create PDF, create spreadsheet'],
      ['RAG', '4 tools', 'Index documents, query indexed documents, list index, clear index'],
      ['Memory', '4 tools', 'Remember facts, recall facts, list memories, forget'],
      ['Git', '5 tools', 'Status, log, diff, commit, branches'],
      ['NBA/Sports', '1 tool', 'Live scores, standings, player stats via ESPN integration'],
      ['Other', '20+ tools', 'Calendar, contacts, email, notifications, reminders, terminal, browser, clipboard, planning, news, image generation'],
    ]
  ));

  children.push(heading('4.4 Security Design', HeadingLevel.HEADING_2));
  children.push(body('SADIE implements defence-in-depth security:'));
  children.push(bullet('SSRF Protection: URL validation blocks loopback, private IPs, and DNS rebinding'));
  children.push(bullet('IPC Hardening: Context isolation, typed preload bridge, path-traversal prevention'));
  children.push(bullet('Webhook Authentication: 256-bit shared secret (X-SADIE-Auth) for all n8n communication'));
  children.push(bullet('Tool Recursion Cap: MAX_TOOL_ROUNDS = 10 prevents infinite tool-call loops'));
  children.push(bullet('API Key Encryption: All API keys encrypted at rest using machine-specific DPAPI'));
  children.push(bullet('Input Sanitisation: Toast XML entity-encoding, Git message character whitelisting, PID injection guard'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 5. Implementation ──
  children.push(heading('5. Implementation'));
  children.push(heading('5.1 Codebase Statistics', HeadingLevel.HEADING_2));
  children.push(simpleTable(
    ['Metric', 'Value'],
    [
      ['Total Lines of TypeScript', '~55,000'],
      ['Tracked Files', '409'],
      ['Git Commits', '398'],
      ['Test Suites', '120'],
      ['Unit Tests', '120 suites'],
      ['Tool Handlers', '85+'],
      ['Cloud LLM Providers', '11'],
      ['Renderer Components', '20+'],
    ]
  ));

  children.push(heading('5.2 Key Implementation Details', HeadingLevel.HEADING_2));

  children.push(heading('5.2.1 Local LLM Integration', HeadingLevel.HEADING_3));
  children.push(body('SADIE communicates with Ollama via its HTTP API at 127.0.0.1:11434. The message router streams responses using Server-Sent Events, providing real-time token-by-token output in the chat UI. Ollama\'s native tool calling support allows the LLM to emit structured JSON tool calls, which SADIE parses, executes, and feeds back as tool results for multi-turn tool use. Model parameters are tuned per hardware profile: mirostat 2 for dynamic perplexity control, configurable context windows (4K–8K), and num_gpu: 99 to maximise GPU offloading.'));

  children.push(heading('5.2.2 Cloud LLM Routing', HeadingLevel.HEADING_3));
  children.push(body('SADIE supports 11 cloud providers through a unified custom LLM client: OpenAI, Anthropic, Google AI Studio, Google Gemini (native), OpenRouter, Groq, DeepSeek, Hugging Face, Cerebras, SambaNova, and Together AI. Each provider uses the appropriate API format — OpenAI-compatible chat/completions for most, Anthropic\'s messages API, and Google Gemini\'s native streamGenerateContent SSE endpoint. The UI auto-fills API URLs and default models when a provider is selected.'));

  children.push(heading('5.2.3 Retrieval-Augmented Generation', HeadingLevel.HEADING_3));
  children.push(body('The RAG engine supports drag-and-drop document indexing for PDF, Word, code, CSV, and Markdown files. Documents are chunked, embedded using Ollama\'s nomic-embed-text model, and indexed locally. At query time, SADIE performs hybrid retrieval combining TF-IDF keyword matching with semantic embedding similarity, returning the most relevant chunks as context for the LLM.'));

  children.push(heading('5.2.4 Agentic Multi-Step Reasoning', HeadingLevel.HEADING_3));
  children.push(body('When SADIE detects a multi-step request (e.g., "search for the weather in Auckland, then save it to a file"), the agentic loop activates. The system prompt is augmented with step-tracking instructions, and the LLM is given the full tool catalogue. After each tool call, results are fed back and the LLM decides whether to call another tool or produce a final answer. A recursion cap of 10 rounds prevents runaway loops, and streaming progress indicators keep the user informed.'));

  children.push(heading('5.2.5 Mixture of Agents (MoA)', HeadingLevel.HEADING_3));
  children.push(body('For users with 16+ GB GPUs, SADIE offers Mixture of Agents — multiple local models (proposers) independently answer the user\'s question, then a stronger model (aggregator) synthesises the best response. Three presets are available: Balanced (qwen2.5:7b + qwen2.5-coder:7b → gemma4:e4b), Code-focused, and Lightweight. This improves answer quality by leveraging the complementary strengths of different model architectures.'));

  children.push(heading('5.2.6 User Interface', HeadingLevel.HEADING_3));
  children.push(body('The React 18 frontend features a glass-morphism design system with light, dark, and system-auto themes. Key UI features include: conversation sidebar with search, pinning, archiving, and tags; markdown rendering with syntax highlighting; inline image and document previews; a model selector showing installed models and VRAM usage; settings panel with hardware auto-detection; first-run onboarding modal; token counter; analytics dashboard; and keyboard shortcuts. The global hotkey Ctrl+Shift+Space toggles SADIE from any application.'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 6. Testing ──
  children.push(heading('6. Testing & Validation'));
  children.push(heading('6.1 Unit Testing', HeadingLevel.HEADING_2));
  children.push(body('SADIE uses Jest for unit testing with ts-jest for TypeScript support. The test suite covers:'));
  children.push(simpleTable(
    ['Test Area', 'Suites', 'Focus'],
    [
      ['Message Router', '15+', 'Tool extraction, context budgets, slash commands, synthesis guards, garbage detection'],
      ['Tool Handlers', '20+', 'File operations, web search fallbacks, vision, NBA, code runner, API tool'],
      ['Config Manager', '5+', 'Hardware profiles, encryption, settings persistence'],
      ['MoA Engine', '5+', 'Preset validation, VRAM estimation, recommendation logic'],
      ['Custom LLM Client', '5+', 'Provider routing, streaming, Gemini native SSE, validation'],
      ['Renderer Components', '15+', 'Settings panel, model selector, message density, notification preferences'],
      ['Shared Modules', '10+', 'Model advisor, daily content, types, constants'],
    ]
  ));

  children.push(heading('6.2 End-to-End Testing', HeadingLevel.HEADING_2));
  children.push(body('Playwright E2E tests launch a real Electron window and test critical user flows: sending messages, receiving streamed responses, switching models, opening settings, and conversation management. E2E tests use sharded parallelism with per-shard artifacts for debugging failures.'));

  children.push(heading('6.3 Manual Testing', HeadingLevel.HEADING_2));
  children.push(body('Manual testing was performed across the three hardware profiles (4 GB, 8 GB, 16+ GB VRAM) to validate: model loading and inference, tool execution, RAG indexing and querying, agentic multi-step chains, cloud LLM connections, and UI responsiveness. Edge cases tested include: large document indexing, concurrent tool calls, model failover when a model is not installed, and API key encryption/decryption across app restarts.'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 7. Evaluation ──
  children.push(heading('7. Evaluation'));
  children.push(heading('7.1 Objectives Met', HeadingLevel.HEADING_2));
  children.push(simpleTable(
    ['Objective', 'Status', 'Evidence'],
    [
      ['Fully offline AI assistant', 'Achieved', 'Ollama local inference with no network calls for core chat'],
      ['85+ tool handlers', 'Achieved', '85+ tools across 20 categories, all locally executed'],
      ['Agentic multi-step reasoning', 'Achieved', 'Autonomous tool chaining with recursion cap and progress streaming'],
      ['RAG document understanding', 'Achieved', 'Hybrid TF-IDF + semantic search with drag-and-drop indexing'],
      ['Cloud LLM routing', 'Achieved', '11 providers including Gemini native streaming'],
      ['Polished desktop UI', 'Achieved', 'Glass-morphism themes, conversation management, keyboard shortcuts'],
      ['Quiz mode and automations', 'Achieved', 'Interactive coding quiz with 12 topics and persistent progress; automation center with scheduled triggers'],
      ['Comprehensive testing', 'Achieved', '120 test suites, all passing'],
    ]
  ));

  children.push(heading('7.2 Limitations', HeadingLevel.HEADING_2));
  children.push(bullet('Local model quality is inherently limited by model size — 7B models cannot match GPT-4 or Claude on complex reasoning'));
  children.push(bullet('GPU VRAM is the primary bottleneck; users with integrated graphics may experience slow inference'));
  children.push(bullet('Windows-only desktop support (Electron is cross-platform, but packaging and testing targeted Windows)'));
  children.push(bullet('No real-time collaboration or multi-user support'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 8. Conclusion ──
  children.push(heading('8. Conclusion'));
  children.push(body('SADIE demonstrates that a privacy-first desktop AI assistant can match the breadth and usability of cloud-based alternatives while keeping all user data local. By combining Ollama for local LLM inference, 85+ TypeScript tool handlers, retrieval-augmented generation, agentic multi-step reasoning, an interactive quiz mode, a reusable automation center, and a modern React-based UI, SADIE provides a practical tool for users who need AI assistance without compromising data privacy.'));
  children.push(body('The project successfully achieved all stated objectives, validated by 120 automated test suites and manual testing across three hardware profiles. The optional cloud LLM integration provides an upgrade path for users who want higher-quality models, while the core offline experience remains fully functional without any API keys or internet connection.'));
  children.push(body('Future work could extend SADIE with a plugin system for community-contributed tools, multi-user support, a mobile companion app, and fine-tuned local models optimised for SADIE\'s specific tool-calling schema.'));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 9. References ──
  children.push(heading('9. References'));
  const refs = [
    'Dettmers, T., Pagnoni, A., Holtzman, A., & Zettlemoyer, L. (2023). QLoRA: Efficient Finetuning of Quantized Language Models. arXiv:2305.14314.',
    'Lewis, P., Perez, E., Piktus, A., et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. arXiv:2005.11401.',
    'Schick, T., Dwivedi-Yu, J., Dessì, R., et al. (2023). Toolformer: Language Models Can Teach Themselves to Use Tools. arXiv:2302.04761.',
    'Ollama. (2024). Ollama Documentation. https://ollama.com',
    'Electron. (2024). Electron Documentation. https://www.electronjs.org/docs',
    'React. (2024). React Documentation. https://react.dev',
    'OpenAI. (2024). Function Calling Guide. https://platform.openai.com/docs/guides/function-calling',
    'Anthropic. (2025). Tool Use Documentation. https://docs.anthropic.com/en/docs/build-with-claude/tool-use',
    'Google. (2025). Gemini API Documentation. https://ai.google.dev/docs',
  ];
  refs.forEach(ref => {
    children.push(new Paragraph({
      spacing: { after: 80, line: 276 },
      indent: { left: 720, hanging: 720 },
      children: [new TextRun({ text: ref, size: 20, font: 'Calibri' })]
    }));
  });

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } }
      }
    },
    sections: [{ children }]
  });
}

// ══════════════════════════════════════════════════════════════════════════
// PRESENTATION
// ══════════════════════════════════════════════════════════════════════════
function slide(title, bullets, notes) {
  const children = [];
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 300 },
    children: [new TextRun({ text: title, size: 48, bold: true, font: 'Calibri', color: BLUE })]
  }));
  if (bullets && bullets.length) {
    bullets.forEach(b => {
      children.push(new Paragraph({
        spacing: { after: 160, line: 320 },
        indent: { left: 720 },
        children: [
          new TextRun({ text: '▸ ', size: 26, font: 'Calibri', color: BLUE }),
          new TextRun({ text: b, size: 26, font: 'Calibri', color: DARK })
        ]
      }));
    });
  }
  if (notes) {
    children.push(spacer());
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Speaker Notes:', size: 18, bold: true, font: 'Calibri', color: GRAY, italics: true })]
    }));
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: notes, size: 18, font: 'Calibri', color: GRAY, italics: true })]
    }));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));
  return children;
}

function buildPresentation() {
  const children = [];

  // Slide 1: Title
  for (let i = 0; i < 4; i++) children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'SADIE', size: 80, bold: true, font: 'Calibri', color: BLUE })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Structured AI Desktop Intelligence Engine', size: 36, font: 'Calibri', color: DARK })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: STUDENT, size: 28, font: 'Calibri' })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: PROGRAMME, size: 22, font: 'Calibri', color: GRAY })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: INSTITUTION, size: 22, font: 'Calibri', color: GRAY })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: `June ${YEAR}`, size: 22, font: 'Calibri', color: GRAY })]
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Slide 2: Agenda
  children.push(...slide('Agenda', [
    'The Problem — why this project exists',
    'SADIE — what it does and how it works',
    'Architecture — Electron, React, Ollama, and the tool system',
    'Key Features — live demo highlights',
    'Technology Stack — languages, frameworks, and testing',
    'Testing & Results — 120 test suites',
    'Live Demonstration',
    'Future Work & Questions',
  ], 'Walk through the agenda quickly (~30 seconds). Let the audience know the live demo comes after the architecture slides.'));

  // Slide 3: The Problem
  children.push(...slide('The Problem', [
    'Cloud AI assistants (ChatGPT, Claude, Gemini) send every message to a remote server',
    'Users handling sensitive data must choose between AI capability and privacy',
    'Local LLM tools (LM Studio, GPT4All) lack tool integration and agentic reasoning',
    'No existing desktop tool combines offline AI + broad tools + polished UX',
  ], 'Emphasise the privacy angle — this is the core motivation. Mention real scenarios: personal documents, business data, local system admin tasks.'));

  // Slide 4: The Solution
  children.push(...slide('SADIE — The Solution', [
    'Privacy-first desktop AI assistant — your data stays on your machine',
    'Runs local LLMs via Ollama — no API keys or internet required for core chat',
    '85+ tool handlers: web search, file management, vision, code runner, RAG, and more',
    'Agentic multi-step reasoning — LLM autonomously chains tools',
    'Optional cloud LLM routing to 11 providers when you want cloud quality',
    'Quiz mode for interactive coding practice and automation center for reusable workflows',
    'One-click installer — no terminal, no manual setup',
  ], 'This is the "elevator pitch" slide. Hit the key differentiators: local-first, tool-rich, agentic, easy to install.'));

  // Slide 5: Architecture
  children.push(...slide('System Architecture', [
    'Electron 28 shell with React 18 renderer and Node.js main process',
    'IPC bridge with context isolation — renderer never touches Node APIs directly',
    'Message router (~5,000 lines) handles intent detection, routing, and tool orchestration',
    'Ollama HTTP API at 127.0.0.1:11434 for local inference',
    '11 cloud LLM providers through unified client (OpenAI, Anthropic, Google, etc.)',
    'Tool handlers execute locally and return structured JSON',
  ], 'Show the architecture diagram from the poster or on-screen. Explain the IPC bridge briefly — it is a key security boundary.'));

  // Slide 6: Architecture Diagram
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 300 },
    children: [new TextRun({ text: 'Architecture Diagram', size: 48, bold: true, font: 'Calibri', color: BLUE })]
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: [
      '┌──────────────────────────────────────────────────────────┐',
      '│                    Electron 28 Shell                     │',
      '│                                                          │',
      '│  ┌──────────────┐    IPC     ┌────────────────────────┐  │',
      '│  │  Renderer     │◄─────────►│  Main Process           │  │',
      '│  │  React 18 UI  │  Bridge   │  Message Router          │  │',
      '│  │  Tailwind CSS │           │  85+ Tool Handlers       │  │',
      '│  │  Glass UI     │           │  Config / Memory / RAG   │  │',
      '│  └──────────────┘           └──────────┬───────────────┘  │',
      '│                                         │                  │',
      '│  ┌──────────────┐  ┌──────────────┐     │                  │',
      '│  │ Ollama       │  │ Cloud LLMs   │◄────┘                  │',
      '│  │ (local AI)   │  │ (11 provdrs) │                        │',
      '│  │ 127.0.0.1:   │  │  (optional)  │                        │',
      '│  │ 11434        │  └──────────────┘                        │',
      '│  └──────────────┘                                          │',
      '└──────────────────────────────────────────────────────────┘',
    ].join('\n'), size: 15, font: 'Consolas' })]
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Slide 7: Tool System
  children.push(...slide('85+ Tool Handlers', [
    'Web Search — 5-engine cascade with SSRF protection',
    'File Manager — read, write, move, delete with path validation',
    'Vision / OCR — image description and text extraction via moondream',
    'RAG Engine — drag-and-drop document indexing with hybrid search',
    'Code Runner — sandboxed code execution with output capture',
    'Git Integration — status, log, diff, commit, branches',
    'Plus: NBA scores, image generation, email, calendar, terminal, browser automation, and more',
  ], 'Spend ~90 seconds here. Pick 2-3 tools to explain in detail. The live demo will show them in action.'));

  // Slide 8: Agentic Reasoning
  children.push(...slide('Agentic Multi-Step Reasoning', [
    'User: "Search for the weather in Auckland, save it to a file, then summarise it"',
    'SADIE detects multi-step intent and activates the agentic loop',
    'LLM calls web_search → receives results → calls write_file → calls summarise',
    'Each tool result is fed back; LLM decides the next step autonomously',
    'Recursion cap (MAX_TOOL_ROUNDS = 10) prevents runaway loops',
    'Streaming progress indicators keep the user informed',
  ], 'This is the "wow" feature. Walk through the example step by step. The live demo should show an agentic chain.'));

  // Slide 9: RAG
  children.push(...slide('Retrieval-Augmented Generation (RAG)', [
    'Drag and drop documents (PDF, Word, code, CSV, Markdown) into SADIE',
    'Documents are chunked and embedded using nomic-embed-text via Ollama',
    'At query time: hybrid TF-IDF keyword + semantic embedding retrieval',
    'Most relevant chunks injected as context for grounded, accurate answers',
    'All indexing and search runs locally — documents never leave your machine',
  ], 'Explain that RAG reduces hallucination by grounding answers in actual documents. Good for asking questions about your own files.'));

  // Slide 10: Cloud LLM Support
  children.push(...slide('Optional Cloud LLM Routing', [
    '11 providers: OpenAI, Anthropic, Google AI Studio, Gemini (native), OpenRouter, Groq, DeepSeek, Hugging Face, Cerebras, SambaNova, Together AI',
    'Unified client handles different API formats (OpenAI-compatible, Anthropic messages, Gemini SSE)',
    'UI auto-fills API URLs and default models when a provider is selected',
    'Users explicitly opt in — SADIE never sends data to the cloud without consent',
    'Free-tier providers (Groq, Cerebras, SambaNova) marked in the UI',
  ], 'Emphasise that cloud is optional. The privacy-first story is about local being the default.'));

  // Slide 11: UI & UX
  children.push(...slide('User Interface', [
    'Glass-morphism design with light, dark, and system-auto themes',
    'Conversation sidebar with search, pinning, archiving, and tags',
    'Markdown rendering with syntax highlighting',
    'First-run wizard: one-click Ollama install + model pull with progress bars',
    'Global hotkey (Ctrl+Shift+Space) toggles SADIE from any application',
    'Analytics dashboard, focus mode, keyboard shortcuts',
  ], 'Show screenshots or switch to the live app here. The glass-morphism UI is visually distinctive.'));

  // Slide 12: Security
  children.push(...slide('Security', [
    'SSRF protection — URL validation blocks loopback, private IPs, DNS rebinding',
    'IPC hardening — context isolation, typed preload bridge, path-traversal prevention',
    'Webhook auth — 256-bit shared secret for n8n communication',
    'Tool recursion cap — MAX_TOOL_ROUNDS = 10',
    'API key encryption at rest (DPAPI)',
    'Input sanitisation — toast XML, Git messages, PID injection guard',
  ], 'Hit these briefly. The examiner may ask about security — know the SSRF and IPC details.'));

  // Slide 13: Technology Stack
  children.push(...slide('Technology Stack', [
    'Electron 28 — cross-platform desktop shell with context isolation',
    'React 18 + TypeScript 5.9 — component-based UI with strong typing',
    'Tailwind CSS 4 — utility-first styling with glass-morphism design',
    'Ollama — local LLM inference with native tool calling',
    'electron-vite — fast builds with HMR for development',
    'electron-builder — NSIS installer for one-click Windows install',
    'Jest (120 test suites) + Playwright (E2E) — comprehensive test coverage',
  ], 'Quick slide. Just name the stack — detail is in the report.'));

  // Slide 14: Testing & Results
  children.push(...slide('Testing & Results', [
    '120 test suites — all passing',
    '~55,000 lines of TypeScript across 409 tracked files',
    '398 commits over the development lifecycle',
    'Playwright E2E tests for critical user flows',
    'Tested across 3 hardware profiles (4 GB, 8 GB, 16+ GB VRAM)',
    'All project objectives achieved',
  ], 'Mention the hardware profiles — shows the project was tested on real constraints, not just powerful machines.'));

  // Slide 15: Live Demo
  children.push(...slide('Live Demonstration', [
    '1. Launch SADIE and show the first-run wizard',
    '2. Send a chat message using local Ollama (offline)',
    '3. Use web search + file write in an agentic chain',
    '4. Drag a document and query it with RAG',
    '5. Describe an image using vision tools',
    '6. Run a coding quiz in Quiz Mode',
    '7. Show Automation Center, settings, themes, conversation management',
  ], 'Switch to the live app now. Follow the demo script in the Demonstration document. Have backup screenshots ready.'));

  // Slide 16: Future Work
  children.push(...slide('Future Work', [
    'Plugin system for community-contributed tool handlers',
    'Multi-user support with per-user encrypted memory stores',
    'Mobile companion app for remote access to local SADIE',
    'Fine-tuned local models optimised for SADIE\'s tool-calling schema',
    'Cross-platform packaging (macOS, Linux)',
  ], 'Keep this brief (~30 seconds). These are genuine next steps, not hand-waving.'));

  // Slide 17: Q&A
  for (let i = 0; i < 3; i++) children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Questions?', size: 64, bold: true, font: 'Calibri', color: BLUE })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Thank you for your time.', size: 28, font: 'Calibri', color: DARK })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: `${STUDENT}  •  ${INSTITUTION}`, size: 22, font: 'Calibri', color: GRAY })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'github.com/kingithegreat/Sadie', size: 22, font: 'Calibri', color: BLUE })]
  }));

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } }
      }
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 1080, right: 1080 },
          size: { orientation: 'landscape', width: 15840, height: 12240 }
        }
      },
      children
    }]
  });
}

// ══════════════════════════════════════════════════════════════════════════
// DEMONSTRATION SCRIPT
// ══════════════════════════════════════════════════════════════════════════
function buildDemonstration() {
  const children = [];

  // Title page
  for (let i = 0; i < 4; i++) children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'SADIE', size: 72, bold: true, font: 'Calibri', color: BLUE })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Live Demonstration Script', size: 32, font: 'Calibri', color: DARK })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: `${STUDENT}  •  ${PROGRAMME}`, size: 22, font: 'Calibri', color: GRAY })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: `${INSTITUTION}  •  June ${YEAR}`, size: 22, font: 'Calibri', color: GRAY })]
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Pre-demo checklist
  children.push(heading('Pre-Demo Checklist'));
  children.push(body('Complete these steps before the demonstration begins. Allow 5–10 minutes.'));
  children.push(spacer());

  const checklistItems = [
    ['Laptop plugged in', 'Battery can drain fast under GPU load — always use mains power'],
    ['Ollama running', 'Run "ollama serve" or verify the system tray icon. Check: curl http://127.0.0.1:11434/api/tags'],
    ['Models pulled', 'Verify: qwen2.5:7b, nomic-embed-text, moondream are listed in "ollama list"'],
    ['SADIE launched', 'Start via npm run dev (developer) or the installed app. Confirm the chat window loads'],
    ['Internet available', 'Needed for web search demo. Have a mobile hotspot as backup'],
    ['Demo files ready', 'Place a sample PDF and an image file on the Desktop for the RAG and vision demos'],
    ['Screen resolution', 'Set to 1920×1080 or higher. Increase font size in settings if projecting'],
    ['Conversation cleared', 'Start with a fresh conversation so the demo is clean'],
    ['Browser closed', 'Close ChatGPT/Claude tabs — avoids confusion about which AI is responding'],
    ['Backup screenshots', 'Have screenshots of each demo step in a folder in case of a failure'],
  ];
  children.push(simpleTable(
    ['Item', 'Details'],
    checklistItems
  ));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Demo script
  children.push(heading('Demonstration Script'));
  children.push(body('Target duration: 10–15 minutes. Each section includes what to say, what to type, and what the audience should see.'));
  children.push(spacer());

  // Demo 1: First Impressions
  children.push(heading('Demo 1: First Impressions (2 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'SADIE\'s UI, global hotkey, and theme switching', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"This is SADIE — a desktop AI assistant that runs entirely on your machine. Let me show you the interface."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(bullet('Show the chat interface — point out the sidebar, model selector, and settings gear'));
  children.push(bullet('Press Ctrl+Shift+Space to hide SADIE, then press it again to bring it back'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"The global hotkey lets you summon SADIE from any application — like Spotlight for AI."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(bullet('Open Settings and switch between light and dark themes'));
  children.push(bullet('Point out the glass-morphism styling and animations'));
  children.push(spacer());

  // Demo 2: Local Chat
  children.push(heading('Demo 2: Local Chat — Fully Offline (2 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'Ollama-powered chat with no internet dependency', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"SADIE uses Ollama to run a 7-billion-parameter language model right here on this laptop. No API keys, no cloud, no data leaving the machine."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Type: '), new TextRun({ text: '"Explain what a binary search tree is in 3 sentences"', size: 22, font: 'Calibri', color: BLUE })]
  }));
  children.push(bullet('Point out the streaming response — tokens appear in real time'));
  children.push(bullet('Show the model selector — currently using qwen2.5:7b'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"The response is generated entirely locally. If I disconnect Wi-Fi right now, it still works."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(spacer());

  // Demo 3: Tool Use
  children.push(heading('Demo 3: Tool Use — Web Search + File Write (3 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'Agentic multi-step tool chain', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"SADIE has 85+ tool handlers. The LLM can chain them autonomously for multi-step tasks. Watch this."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Type: '), new TextRun({ text: '"Search for the current weather in Tauranga and save the results to a file called weather.txt on my Desktop"', size: 22, font: 'Calibri', color: BLUE })]
  }));
  children.push(bullet('Point out the tool call indicators as they appear (web_search → write_file)'));
  children.push(bullet('After completion, open the Desktop and show the weather.txt file'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"The LLM decided on its own to search the web, extract the weather, and write it to a file. That is agentic reasoning — I gave one instruction and it figured out the steps."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(spacer());

  // Demo 4: RAG
  children.push(heading('Demo 4: RAG — Document Understanding (2 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'Drag-and-drop document indexing and grounded Q&A', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"SADIE can index your documents and answer questions grounded in their content — no hallucination, because it references the actual text."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(bullet('Drag a sample PDF from the Desktop into the SADIE chat window'));
  children.push(bullet('Wait for the indexing progress indicator to complete'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Type: '), new TextRun({ text: '"What are the main points in the document I just uploaded?"', size: 22, font: 'Calibri', color: BLUE })]
  }));
  children.push(bullet('Show that SADIE\'s response references specific content from the document'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"The document was indexed locally using nomic-embed-text embeddings. The search uses a hybrid TF-IDF plus semantic approach. Nothing was sent to the cloud."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(spacer());

  // Demo 5: Vision
  children.push(heading('Demo 5: Vision — Image Understanding (1 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'Local image description via moondream', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"SADIE can also understand images using a local vision model."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Type: '), new TextRun({ text: '"Describe this image" (attach a sample image)', size: 22, font: 'Calibri', color: BLUE })]
  }));
  children.push(bullet('Show the description generated by the moondream vision model'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"That was processed entirely locally using the moondream model — 1.7 GB, runs on any GPU."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(spacer());

  // Demo 6: Quiz Mode
  children.push(heading('Demo 6: Quiz Mode (2 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'Interactive coding quiz with progress tracking', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"SADIE includes a quiz mode for coding practice. You can pick a topic, difficulty, and number of questions."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(bullet('Switch to Quiz Mode using Ctrl+5 or the sidebar'));
  children.push(bullet('Select a topic (e.g., Python), difficulty (Medium), and 3 questions'));
  children.push(bullet('Answer one or two questions to show the flow'));
  children.push(bullet('Show the score summary and persistent progress tracking'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"Progress is saved between sessions — you can track your improvement over time across all topics."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(spacer());

  // Demo 7: Automation Center
  children.push(heading('Demo 7: Automation Center (1 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'Creating and running reusable automations', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"The Automation Center lets you create reusable task workflows. You write plain-English instructions and SADIE executes them through its full tool chain."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(bullet('Switch to Automation mode using Ctrl+2'));
  children.push(bullet('Create a new automation called "Morning News Summary"'));
  children.push(bullet('Set instructions: "Search for today\'s top tech news and give me a 3-bullet summary"'));
  children.push(bullet('Click Run and show the result'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"Automations can run on a schedule — from every 15 minutes to once a day. They persist across sessions."', size: 22, font: 'Calibri', italics: true })]
  }));
  children.push(spacer());

  // Demo 8: Settings & Conversation Management
  children.push(heading('Demo 8: Settings & Management (1 min)', HeadingLevel.HEADING_2));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [bold('What to show: '), new TextRun({ text: 'Configuration depth and conversation management', size: 22, font: 'Calibri' })]
  }));
  children.push(spacer());
  children.push(bullet('Open Settings — show the model configuration, hardware profile, and tool list'));
  children.push(bullet('Show the conversation sidebar — pinning, archiving, search'));
  children.push(bullet('Show the analytics dashboard (if enabled)'));
  children.push(bullet('Show the cloud LLM configuration panel — emphasise that it is optional'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"Everything is configurable. You can change models, add cloud providers, enable or disable individual tools, and manage your conversations."', size: 22, font: 'Calibri', italics: true })]
  }));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Closing
  children.push(heading('Closing (30 seconds)'));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [bold('Say: '), new TextRun({ text: '"To summarise — SADIE is a privacy-first desktop AI assistant with 85+ tools, agentic reasoning, RAG, vision, quiz mode, automations, and a one-click installer. It runs entirely on your machine. Everything you saw today was processed locally. Thank you — I\'m happy to take questions."', size: 22, font: 'Calibri', italics: true })]
  }));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Backup & Troubleshooting
  children.push(heading('Backup Plan & Troubleshooting'));
  children.push(body('If something goes wrong during the demo, use these recovery steps:'));
  children.push(spacer());
  children.push(simpleTable(
    ['Problem', 'Recovery'],
    [
      ['Ollama not responding', 'Open a terminal, run "ollama serve". Wait 5 seconds, retry. If still down, show backup screenshots.'],
      ['Model loading slowly', 'Say "The model is loading into GPU memory — this is a one-time cost per session." Wait, or switch to a smaller model.'],
      ['Web search fails', 'Say "Web search requires internet — let me show an offline demo instead." Use a local file operation.'],
      ['Tool call hangs', 'Click "Stop" in the chat. Say "Tool calls have a timeout and recursion cap for safety." Move to the next demo.'],
      ['App crashes', 'Restart with npm run dev. While it loads, talk about the architecture. Use backup screenshots if restart is slow.'],
      ['RAG indexing slow', 'Say "Indexing speed depends on document size and GPU. For the demo I\'ll use a small document." Use a 1-page PDF.'],
      ['Vision model not pulled', 'Run "ollama pull moondream" quickly, or skip to the next demo and mention vision capability verbally.'],
    ]
  ));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Anticipated Questions
  children.push(heading('Anticipated Questions & Answers'));
  children.push(spacer());

  const qaItems = [
    ['How does SADIE compare to ChatGPT?', 'ChatGPT requires internet and sends everything to OpenAI servers. SADIE runs locally — your data never leaves your machine. The trade-off is that local 7B models are less capable than GPT-4, but SADIE also supports cloud providers when you want that quality.'],
    ['What happens without a GPU?', 'SADIE works in CPU-only mode, but inference is significantly slower (10-30x). A 4 GB GPU is recommended for a practical experience. The first-run wizard detects your hardware and sets appropriate defaults.'],
    ['Is this secure?', 'Yes. SADIE implements SSRF protection, IPC hardening with context isolation, API key encryption at rest, tool recursion caps, webhook authentication, and input sanitisation. The renderer process never has direct access to Node.js APIs.'],
    ['Why Electron instead of a native app?', 'Electron provides a mature cross-platform framework with strong security primitives (context isolation, sandboxed preload). The React ecosystem offers component libraries, styling tools, and a large developer community. The trade-off is higher memory usage compared to native, but it is acceptable for a desktop AI assistant.'],
    ['How many models can it run?', 'Any model that Ollama supports — hundreds of open-source models. The default is qwen2.5:7b (4.7 GB VRAM) but users can switch to larger models like gemma4:e4b (9.6 GB) if they have the hardware.'],
    ['What about multi-user or mobile?', 'These are future work items. Currently SADIE is single-user, Windows desktop. The architecture could support a companion mobile app that connects to the local SADIE instance over the network.'],
  ];

  qaItems.forEach(([q, a]) => {
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [bold(`Q: ${q}`)]
    }));
    children.push(new Paragraph({
      spacing: { after: 160, line: 276 },
      indent: { left: 360 },
      children: [new TextRun({ text: `A: ${a}`, size: 22, font: 'Calibri' })]
    }));
  });

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } }
      }
    },
    sections: [{ children }]
  });
}

// ── Generate all documents ──────────────────────────────────────────────────
async function main() {
  const outDir = path.resolve(__dirname, '..');

  const docs = [
    { name: 'SADIE_Poster.docx', builder: buildPoster },
    { name: 'SADIE_Project_Report.docx', builder: buildReport },
    { name: 'SADIE_Presentation.docx', builder: buildPresentation },
    { name: 'SADIE_Demonstration.docx', builder: buildDemonstration },
  ];

  for (const { name, builder } of docs) {
    const doc = builder();
    const buf = await Packer.toBuffer(doc);
    const outPath = path.join(outDir, name);
    fs.writeFileSync(outPath, buf);
    console.log('Created:', outPath);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
