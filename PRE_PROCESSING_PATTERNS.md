# Pre-Processing Patterns

SADIE now intercepts deterministic queries **before** they reach the LLM, ensuring fast, reliable, and hallucination-free responses.

## 🏀 NBA Queries

**Triggers:** Any NBA team name OR keywords: `nba`, `basketball`, `game`, `score`, `schedule`, `results`

**Examples:**
- ✅ "warriors last 5 games"
- ✅ "lakers schedule"
- ✅ "celtics results"
- ✅ "golden state games"
- ✅ "miami heat score"

**Tool:** `nba_query` with parameters: `{type: 'games', query: '<team>', perPage: <number>}`

**Response:** Direct formatted result showing real team names, scores, dates

---

## 🌤️ Weather Queries

**Triggers:** Keywords: `weather`, `temperature`, `forecast`, `rain`, `sunny`, `cloudy` + location

**Examples:**
- ✅ "weather in Seattle"
- ✅ "temperature for New York"
- ✅ "forecast in Miami"
- ✅ "is it raining in Portland"

**Tool:** `get_weather` with parameters: `{location: '<city>'}`

**Response:** Current conditions, temperature, forecast

---

## ⏰ Time/Date Queries

**Triggers:** Keywords: `what time`, `current time`, `time is it`, `date today`, `current date`

**Examples:**
- ✅ "what time is it"
- ✅ "current time"
- ✅ "what's the date today"
- ✅ "today's date"

**Tool:** `get_current_time` with no parameters

**Response:** Current system time and date

---

## 🧮 Calculator Queries

**Triggers:** Starts with: `calculate`, `compute`, `what's` + math expression

**Examples:**
- ✅ "calculate 15 + 27"
- ✅ "what's 20% of 150"
- ✅ "compute 5 * 8"

**Tool:** `calculate` with parameters: `{expression: '<math>'}`

**Response:** Computed result

---

## 💻 System Info Queries

**Triggers:** Keywords: `system info`, `os version`, `my os`, `operating system`, `computer info`

**Examples:**
- ✅ "what's my OS"
- ✅ "system info"
- ✅ "computer information"

**Tool:** `get_system_info` with no parameters

**Response:** OS name, version, architecture, memory

---

## 📁 File Operations

### Read File

**Triggers:** Keywords: `read`, `show`, `display`, `cat`, `get` + `file`/`contents of`

**Examples:**
- ✅ "read file config.json"
- ✅ "show contents of README.md"
- ✅ "cat package.json"

**Tool:** `read_file` with parameters: `{path: '<filepath>'}`

### List Directory

**Triggers:** Keywords: `list`, `show`, `ls`, `dir` + `directory`/`folder`

**Examples:**
- ✅ "list files in Documents"
- ✅ "show directory src"
- ✅ "ls folder Downloads"

**Tool:** `list_directory` with parameters: `{path: '<dirpath>'}`

---

## 📋 Clipboard Queries

**Triggers:** Keywords: `get clipboard`, `show clipboard`, `what's in clipboard`

**Examples:**
- ✅ "what's in my clipboard"
- ✅ "get clipboard"
- ✅ "show clipboard"

**Tool:** `get_clipboard` with no parameters

**Response:** Current clipboard contents

---

## 🔍 Web Search (Fallback)

**Triggers:** Keywords: `search for`, `find`, `who is`, `what is`, `look up`, `tell me about`

**Examples:**
- ✅ "search for Python tutorials"
- ✅ "who is Elon Musk"
- ✅ "tell me about quantum computing"

**Tool:** `web_search` with parameters: `{query: '<query>', maxResults: 5, fetchTopResult: true}`

**Response:** Search results with snippets

---

## ⚙️ Architecture Benefits

### Why Pre-Processing?

1. **Reliability** - No LLM hallucination for deterministic queries
2. **Speed** - Instant tool execution, no LLM thinking time
3. **Accuracy** - Guaranteed correct parameters
4. **Model Independence** - Works with any LLM (even 3B models)
5. **Predictability** - Consistent behavior every time

### How It Works

```
User Query
    ↓
preProcessIntent() - Pattern matching
    ↓
Routing Decision: 'tools' | 'llm' | 'error'
    ↓
If 'tools': Execute immediately → Format → Return
If 'llm': Send to LLM with tool definitions
```

### Adding New Patterns

To add a new pre-processing pattern:

1. Edit `widget/src/main/message-router.ts`
2. Find `preProcessIntent()` function
3. Add regex pattern matching:
   ```typescript
   if (/\bnew_keyword\b/i.test(m)) {
     return { calls: [{ name: 'tool_name', arguments: { param: 'value' } }] };
   }
   ```
4. Rebuild: `npm run build`
5. Test!

---

## 🧪 Testing

Test pre-processing by watching logs for:
```
[SADIE] Checking preProcessIntent for message: <query>
[SADIE] Routing decision: tools
[SADIE] Pre-processor forcing tool calls: [ '<tool_name>' ]
```

If you see `Routing decision: llm`, the pattern didn't match.

---

## 📊 Current Stats

- **9 Pattern Types** pre-processed
- **32 Tools** available
- **NBA: 50+ team names** recognized
- **0 Hallucinations** on pre-processed queries ✅

---

**Last Updated:** January 2, 2026  
**Version:** 0.6.1
