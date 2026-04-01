# SADIE — Structured AI Desktop Intelligence Engine

**Project Proposal**

**Date Last Revised:** 14 March 2026

---

## Project Details

- **Project Title:** SADIE — Structured AI Desktop Intelligence Engine
- **Student:** Aden Kingi  |  Student No: 9821836  |  adenking@hotmail.com
- **Supervisor:** Francisco Roldao
- **Institution:** Toi Ohomai Institute of Technology
- **Platform:** Windows 11
- **Sponsor:** Independent / Self-Sponsored Academic Industry Simulation

---

## Executive Summary

SADIE (Structured AI Desktop Intelligence Engine) is a secure, offline-first desktop AI assistant that enables structured, privacy-preserving AI interactions on Windows. The system is substantially built: a working Electron and React desktop application, a modular n8n-based tool execution engine, and local large language model inference via Ollama are all operational.

The core architecture — including tool endpoints for web search, file management, system inspection, OCR/vision, planning, and memory (plus optional remote LLM APIs like ChatGPT and Claude) — has been prototyped and validated. The remaining project effort is focused on hardening, testing, documentation, and packaging rather than new feature development.

---

## Background

AI assistants are rapidly becoming essential productivity tools across software development, education, and business. However, most current solutions require continuous internet connectivity and route sensitive data through third-party cloud infrastructure.

SADIE builds on local AI inference technology (Ollama), low-code workflow orchestration (n8n), and modern desktop application development (Electron + React + TypeScript) to deliver a privacy-focused assistant that runs entirely on the user's own machine. A working prototype has been developed and is undergoing refinement.

---

## Current Implementation Status

The following components are already built and operational:

| Component | Description | Status |
|-----------|-------------|--------|
| Electron + React Shell | Desktop application with TypeScript and Vite | ✅ Complete |
| n8n Tool Engine | Webhook-based modular tool registry (HTTP endpoints) | ✅ Complete |
| Web Search Tool | DuckDuckGo search via PowerShell | ✅ Complete |
| File Manager Tool | Safe read/write/list/move via FileOps.ps1 | ✅ Complete |
| System Info Tool | Disk/process/memory/network via SystemInfo.ps1 | ✅ Complete |
| Vision / OCR Tool | Tesseract OCR + LLaVA visual model | ✅ Complete |
| Planning Agent | Ollama (llama3.2:3b) generates structured task plans | ✅ Complete |
| LLM API Connectors | ChatGPT + Claude remote model inference (OpenAI & Anthropic) | ✅ Complete |
| Memory Manager | Persistent context and fact storage | ✅ Complete |
| Browser Automation | Automated browser interactions | ✅ Complete |
| API Tool / Archive Ops | External API calls and archive management | ✅ Complete |
| Test Infrastructure | Jest unit tests + Playwright E2E configured | 🔄 In Progress |
| Installer Package | Windows executable packaging | 🔄 In Progress |

---

## Project Objectives

- Deliver a production-quality Electron desktop application with full UI/UX polish
- Maintain and extend the n8n-based modular tool execution engine
- Achieve comprehensive unit and end-to-end test coverage across all tool endpoints
- Harden security: sandboxed execution, input validation, and network access controls
- Produce complete technical documentation and architecture guides
- Package a Windows installer with all dependencies clearly documented
- Deliver a final academic report with reflection on design decisions and outcomes

---

## Problem Statement

There is growing demand for AI-driven productivity tools that preserve user privacy and operate reliably in offline or restricted-network environments. Existing solutions frequently expose sensitive data to third-party cloud services, provide limited transparency over automated processes, and depend entirely on external infrastructure.

SADIE addresses this by delivering a locally executable AI assistant — already functioning — that performs structured multi-tool automation within clearly defined, auditable security boundaries.

---

## Project Justification

### Business Drivers

- Growing market demand for privacy-focused, offline-capable AI tools
- Data sovereignty requirements in professional and regulated environments
- Opportunity to commercialise as a startup product post-graduation

### Academic Drivers

- Demonstrates secure software architecture across a full-stack TypeScript application
- Applies agile development, testing methodology, and technical documentation competencies
- Showcases integration of modern AI inference (Ollama), desktop frameworks (Electron), and workflow orchestration (n8n)

---

## Milestones and Remaining Work

The project is ahead of schedule. The core system is built. Remaining milestones focus exclusively on quality, testing, and documentation:

| Phase | Dates | Deliverable | Focus |
|-------|-------|-------------|-------|
| Proposal & Initiation | Feb 23 – Mar 15 | Approved proposal | ✅ Complete |
| Architecture & Core Build | Mar 16 – Apr 5 | Electron shell + tool engine | ✅ Complete |
| Tool Integration | Apr 6 – Apr 26 | Midpoint working prototype | ✅ Complete |
| Test Coverage | Apr 27 – May 10 | Unit + E2E tests for all tools | Testing |
| Code Quality & Security | May 11 – May 25 | Refactoring + security hardening | Polish |
| Documentation | May 26 – Jun 8 | Architecture docs + setup guide | Docs |
| Finalisation | Jun 9 – Jun 19 | Final build + report submission | Submission |
| Presentation | Jun 22 | Project demonstration | Demo |

---

## Scope

### Included

- Desktop application (Electron + React + TypeScript)
- Local AI model inference via Ollama (llama3.2:3b for reasoning, LLaVA for vision)
- n8n-based modular tool execution engine with HTTP webhook endpoints
- Tool set: web search, file management, system info, OCR/vision, planning, memory, browser automation, remote LLM APIs (ChatGPT/Claude), API calls, archive operations
- Unit tests (Jest) and end-to-end tests (Playwright)
- Execution logging and audit trail
- Windows installer packaging (with Docker/Ollama as documented prerequisites)
- Technical documentation and architecture guide

### Excluded

- Mobile platform support
- Cloud deployment or hosted infrastructure
- Enterprise authentication or governance systems
- Distributed workflow orchestration
- Full commercial deployment

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Low-VRAM machine — LLM performance degraded | Medium | High | Support configurable model selection; document minimum hardware requirements; allow CPU-only mode |
| Docker/n8n dependency complexity in installer | Medium | Medium | Clearly document prerequisites; provide setup script; scope installer to app only |
| Scope expansion beyond testing/docs focus | Medium | Medium | Strictly milestone-based prioritisation; new features deferred post-submission |
| PowerShell sandbox escape / unsafe file ops | Low | High | Path validation already in FileOps.ps1; extend with allowlist and automated security tests |
| Dependency vulnerabilities | Low | High | Version locking; npm audit in CI; regular scanning |

---

## Methodology

An Agile iterative methodology is followed with weekly supervisor discussions, incremental delivery, and continuous documentation. Given that the core system is already built, the remaining iterations focus on test-driven quality assurance: writing tests before refactoring code, addressing security findings, and producing documentation in parallel with code improvements.

Each week produces a measurable output: test coverage increases, a documentation section completed, or a code quality metric improved. This approach maintains academic rigour while managing the remaining scope conservatively.

---

## Deliverables

| Deliverable | Description |
|-------------|-------------|
| SADIE Desktop Application | Polished, fully functional offline AI assistant |
| Source Code Repository | Documented TypeScript codebase (Electron, React, n8n workflows, PowerShell scripts) |
| Test Suite | Jest unit tests and Playwright E2E tests with coverage report |
| Technical Documentation | Architecture guide, tool endpoint reference, setup instructions |
| Windows Installer | Electron executable with documented dependency prerequisites |
| Final Academic Report | Reflection on design decisions, testing outcomes, and commercial viability |

---

## Resource Requirements

**Software**
- Node.js + npm (Electron, React, TypeScript, Vite, Jest, Playwright)
- Docker Desktop (n8n orchestration runtime)
- Ollama (local LLM inference — llama3.2:3b, LLaVA)
- n8n (workflow tool engine, self-hosted in Docker)
- Tesseract OCR
- Visual Studio Code

**Hardware**
- Windows 11 development machine
- Minimum 16GB RAM recommended for local LLM inference
- GPU with 8GB+ VRAM preferred for acceptable LLaVA performance

---

## Budget

- All software: open source / zero cost
- Hardware: existing
- Total estimated cost: Nil

---

## Intellectual Property Statement

All intellectual property rights for SADIE belong to Aden Kingi. Toi Ohomai Institute of Technology may retain copies of project documentation for academic purposes.

---

## Confidentiality

All project documentation and deliverables remain confidential between the student and academic supervisors unless otherwise agreed.

---

## Project Team Declaration

- I am not employed by a sponsoring organisation.
- No conflicts of interest exist.
- Information provided is accurate to the best of my knowledge.

---

## Project Proposal Approval

| Role | Name | Signature / Date |
|------|------|----------------|
| Project Team Leader | Aden Kingi | __________________ |
| Supervisor | Francisco Roldao | __________________ |
