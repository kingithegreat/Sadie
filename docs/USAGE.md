# Sadie Usage Guide

## Overview

Sadie is a sweet, helpful, and safe AI assistant that runs completely offline on your Windows machine. She can help with various tasks while maintaining strict safety guidelines.

## Starting Sadie

### Desktop Widget (Recommended)
```bash
python -m sadie.main
```

This opens a desktop widget where you can chat with Sadie.

### Command Line Interface
```bash
python -m sadie.main --cli
```

Interactive CLI mode for terminal users.

### Single Command
```bash
python -m sadie.main --message "Your message here"
```

## Capabilities

### 1. File Operations

**Reading files:**
- "Read the contents of my document.txt"
- "Show me what's in C:/Users/YourName/Documents/notes.txt"

**Writing files:**
- "Create a file called todo.txt with my tasks"
- "Append 'Buy groceries' to my shopping list"

**Managing files:**
- "List all files in my Documents folder"
- "Copy report.docx to my Desktop"
- "Move old files to the Archive folder"

**Safety Note:** Sadie will not access system directories or delete files without confirmation.

### 2. Vision Capabilities

**Image description:**
- "Describe this image: C:/Users/YourName/Pictures/photo.jpg"
- "What do you see in this screenshot?"

**Text extraction (OCR):**
- "Extract text from this receipt image"
- "Read the text in this scanned document"

**Requirements:** LLaVA model for descriptions, Tesseract for OCR

### 3. Voice Input

**Transcription:**
- "Transcribe the audio file meeting.wav"
- Use the voice input button in the widget to record and transcribe

**Requirements:** Whisper model (downloads automatically on first use)

### 4. Email

**Drafting:**
- "Draft an email to john@example.com about the meeting"
- "Create an email with subject 'Project Update'"

**Note:** Email sending is disabled by default for safety. Enable in config.yaml if needed.

### 5. Task Planning

**Complex tasks:**
- "Help me plan how to organize my files"
- "Break down the steps to create a presentation"
- "What's the best way to backup my documents?"

Sadie will create step-by-step plans for complex tasks.

### 6. API Calls

**Web requests:**
- "Get data from this API endpoint"
- "Check the weather API"

**Note:** Configure allowed domains in config.yaml for security.

### 7. Memory & Context

Sadie remembers your conversation within each session:
- "What did I ask you earlier?"
- "Continue from where we left off"

## Safety Features

### Automatic Protections

Sadie will **automatically block**:
- Access to system directories (Windows, System32, Program Files)
- Destructive commands (format, registry edits)
- Operations on files outside safe directories

### Confirmation Required

Sadie will **ask for confirmation** before:
- Deleting any files
- Moving files
- Sending emails
- Running system commands

### Safe Alternatives

When an action is unsafe, Sadie will:
- Explain why it's not allowed
- Suggest a safer alternative
- Guide you to do it manually if necessary

## Examples

### Example 1: File Organization
```
You: Help me organize my Downloads folder

Sadie: I can help you with that! Let me first see what's in your Downloads folder.

[Sadie lists files and suggests organization by type]

Sadie: Would you like me to:
1. Create folders for Documents, Images, and Archives
2. Move files into appropriate folders
3. Show you which files are old and can be archived

You: Yes, create the folders

Sadie: I'll create those folders for you.
[Creates folders and confirms]
```

### Example 2: Image Analysis
```
You: What's in this screenshot? C:/Users/Me/Desktop/screenshot.png

Sadie: Let me analyze that image for you.

[Sadie describes the image content and extracts any visible text]
```

### Example 3: Planning a Task
```
You: I need to prepare a presentation about our project

Sadie: I can help you plan that! Here's a step-by-step approach:

1. Gather all project documents and data
2. Create an outline with main points
3. Design slides with key information
4. Add visuals and charts
5. Practice the presentation

Would you like help with any specific step?
```

## Tips

1. **Be specific:** The more details you provide, the better Sadie can help
2. **Use full paths:** Always provide complete file paths for accuracy
3. **Check status:** Use `--status` flag to verify all services are running
4. **Safe directories:** Configure safe directories in config.yaml for frequent access
5. **Review actions:** Always review Sadie's suggestions before confirming destructive operations

## Configuration

Edit `config/config.yaml` to customize:

- **Models:** Change Ollama model (llama2, mistral, etc.)
- **Safety:** Adjust forbidden directories and blocked actions
- **Modules:** Enable/disable specific capabilities
- **UI:** Customize widget appearance and behavior

## Keyboard Shortcuts (Widget)

- **Enter:** Send message
- **Ctrl+Q:** Quit application
- **Ctrl+L:** Clear conversation

## Getting Help

Within Sadie:
- "What can you help me with?"
- "Show me examples"
- "Check system status"

Documentation:
- See [INSTALLATION.md](INSTALLATION.md) for setup
- See [API.md](API.md) for technical details
- Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues
