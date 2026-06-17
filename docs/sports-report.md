# HomeBot Sports and NBA Integration

HomeBot integrates with ESPN's public API to provide live NBA scores, standings, full-season results, and player statistics. This document covers the sports tool capabilities, configuration, permissions, and usage.

---

## Table of Contents

1. [Overview](#overview)
2. [Capabilities](#capabilities)
3. [Permissions](#permissions)
4. [Usage Examples](#usage-examples)
5. [Sports Report Tool](#sports-report-tool)
6. [Technical Details](#technical-details)
7. [Testing](#testing)

---

## Overview

The sports integration is built on two components:

- **`nba_query` tool** — Fetches live game data, standings, and player statistics from ESPN endpoints. Results are parsed and formatted for display in the chat interface.
- **`generate_sports_report` tool** — Builds a formatted report (HTML or TXT) from NBA data and saves it to the user's Desktop.

All data is fetched from ESPN's public endpoints. No API key is required.

---

## Capabilities

| Feature | Description |
|---|---|
| **Live scores** | Current scores for games in progress, including quarter and time remaining |
| **Today's results** | Final scores for today's completed games |
| **Full-season results** | Fetches all games for the current NBA season using ESPN's date-range API via `fetchSeasonEvents()` |
| **Standings** | Conference standings (Eastern and Western) with win-loss records |
| **Player stats** | Individual player statistics for a specific game |
| **Table formatting** | Results can be displayed in a formatted table when the user requests "in a table" |
| **Previous-day fallback** | When today's games are all pre-game (not yet started), automatically falls back to yesterday's results |
| **NZ/AU timezone handling** | Correctly handles timezone offset where "today" in New Zealand may correspond to "yesterday" in US Eastern time |

---

## Permissions

The `nba_query` tool requires no special permissions. It is a read-only data fetch.

The `generate_sports_report` tool writes files to the user's Desktop and requires:

| Permission | Description | Default |
|---|---|---|
| `write_file` | Allows HomeBot to write files to your system | Disabled |
| `generate_sports_report` | Tool-level permission for the report generator | Disabled |

When either permission is missing, HomeBot will display a permission modal with the options: **Allow once**, **Always allow**, or **Cancel**.

### Permission Escalation Flow

If a requested action requires permissions that are currently disabled, HomeBot returns a structured response:

```json
{
  "status": "needs_confirmation",
  "missingPermissions": ["generate_sports_report", "write_file"],
  "reason": "This action will create folders and write files to your Desktop."
}
```

The renderer displays a clear modal explaining what will happen and where files will be written.

---

## Usage Examples

### Quick Queries

```
What are the current NBA standings?
What are today's NBA scores?
Who is winning the Lakers game?
```

### Full-Season Data

```
Give me all this season's NBA results
Show me this season's NBA results in a table
```

HomeBot detects full-season intent via regex matching (`wantsSeason`) and fetches all games using ESPN's date-range API rather than single-day endpoints.

### Formatted Output

```
Show me today's NBA scores in a table
```

Adding "in a table" triggers `format='table'` detection, which returns a structured table layout instead of plain text.

### Report Generation

```
Create a folder on my Desktop and fill it with this week's NBA results as an HTML report
```

HomeBot will:
1. Check `write_file` and `generate_sports_report` permissions.
2. Prompt the user if permissions are missing.
3. Fetch NBA data from ESPN.
4. Generate the report and save it to `Desktop/NBA Results/report.html`.

---

## Sports Report Tool

The `generate_sports_report` tool accepts the following parameters:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `league` | string | Yes | — | League identifier (currently only `nba` is supported) |
| `date` | string | No | Current date | Date for the report (ISO format: `YYYY-MM-DD`) |
| `directory` | string | No | `Desktop/NBA Results` | Output directory (HomeBot normalises `Desktop/...` to the correct absolute path) |
| `format` | string | No | `html` | Output format: `html` or `txt` |
| `includeSummary` | boolean | No | `true` | Include a narrative summary paragraph |

Example tool call:

```json
{
  "name": "generate_sports_report",
  "parameters": {
    "league": "nba",
    "date": "2026-04-10",
    "directory": "Desktop/NBA Results",
    "format": "html",
    "includeSummary": true
  }
}
```

---

## Technical Details

### ESPN Integration

- **Scoreboard endpoint** — Fetches today's games with scores, statuses, and team information.
- **Standings endpoint** — Conference standings with win-loss records and rankings.
- **Date-range endpoint** — Used by `fetchSeasonEvents()` for full-season data retrieval. Avoids the limitation of single-day fetches that would only return games from one date.
- **Player stats** — Per-game player statistics from ESPN's event detail endpoints.

### Intent Detection

The message router detects sports intent using pattern matching:

- **`wantsResults`** — Detects requests for game results and scores.
- **`wantsSeason`** — Detects full-season requests (e.g., "all this season's results").
- **`wantsTable`** — Detects table formatting requests (e.g., "in a table").
- **`wantsStandings`** — Detects standings requests.
- **Sport-query guard** — Tightened regex prevents false positives where non-sports messages are incorrectly routed.

### Previous-Day Fallback

When the user asks for "today's results" but all games are in pre-game status (none have started yet), HomeBot automatically checks yesterday's games for completed results. This handles the common scenario where a user asks for results in the morning before any games have been played.

---

## Testing

Unit tests for the sports integration are located in `widget/src/main/__tests__/`:

| Test File | Coverage |
|---|---|
| `sports.test.ts` | Core sports data tool routing |
| `nba.test.ts` | Data parsing and formatting (scores, standings) |
| `nba-fallback.test.ts` | Graceful degradation when ESPN API fails |
| `nba-http.test.ts` | HTTP endpoint path validation |
| `nba-nz-timezone.test.ts` | NZ/AU timezone edge cases and previous-day fallback |
| `runtime-nba-smoke.test.ts` | End-to-end smoke test for NBA queries |

Run sports-specific tests:

```bash
cd widget
npx jest --config jest.config.ts nba --no-coverage
npx jest --config jest.config.ts sports --no-coverage
```
