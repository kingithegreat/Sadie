/**
 * skills-seed.ts — the skills HomeBot ships with.
 *
 * These are written to userData/skills/ on first run rather than packaged as
 * asset files. Two reasons:
 *
 *  1. Bundling. electron-vite inlines the main process into a single file;
 *     anything read from a relative path at runtime has repeatedly gone
 *     missing in this codebase. A string constant cannot.
 *  2. They are meant to be edited. Seeding real markdown into the user's own
 *     folder makes them examples, not black boxes — open one, change it, and
 *     the change sticks.
 *
 * Existing files are never overwritten, so a user edit survives every update.
 */

import * as fs from 'fs';
import * as path from 'path';
import { skillsDir } from './skills';

interface SeedSkill { folder: string; content: string }

const SEEDS: SeedSkill[] = [
  {
    folder: 'research-a-question',
    content: `---
name: research-a-question
description: Answer a question about current events or anything recent, with sources
when_to_use: The user asks about news, sport, prices, releases, or anything after your training data
tools: [web_search, fetch_url]
---

# Research a question

Follow these steps in order. Do not skip step 1.

## 1. Write a standalone search query

The user's message is often a follow-up and makes no sense on its own.
"Who is likely to make the playoffs?" does not say which sport. "What about
him?" does not say who.

Before searching, rewrite the question so it would make sense to a stranger who
has not read the conversation:

- Put the subject back in. If the conversation is about the NBA, the query must
  contain "NBA" — otherwise the search engine will answer about the NFL.
- Put the year or season in, e.g. "2026-27 season".
- Drop conversational filler: "but", "so", "im talking about".

Bad: \`who is likely to make the playoffs\`
Good: \`NBA 2026-27 season playoff predictions\`

## 2. Search

Call web_search with that rewritten query.

## 3. If the snippets are thin, open the page

Search results are two-line previews. If they do not actually contain the
answer, pick the most promising result and call fetch_url on it to read the
page itself. Do not report "the snippet doesn't specify" — that is a signal to
fetch, not to give up.

## 4. Answer

- Lead with the answer, not with a description of your search.
- Cite which source each claim came from.
- If the sources genuinely do not answer it, say so plainly and say what you
  would need. Do not pad with what you did find if it is off-topic.
- If a result is about a different subject than asked (NFL when asked about the
  NBA), discard it. Do not report it.
`,
  },
  {
    folder: 'make-an-automation',
    content: `---
name: make-an-automation
description: Turn something the user wants to happen regularly into a saved automation
when_to_use: The user says "every morning", "each week", "remind me to", or "automatically"
tools: [create_automation, list_automations, run_automation]
---

# Make an automation

## 1. Work out the three things you need

- **name** — short, e.g. "Morning news summary"
- **instructions** — a plain-English prompt describing exactly what to do each
  run. Write it as if instructing a fresh assistant with no memory of this
  conversation. Name the tools it should use.
- **schedule** — how often, in minutes. Daily is 1440. Hourly is 60.

If the user has not said how often, ask. Do not assume.

## 2. Create it

Call create_automation with name, instructions, and trigger="schedule" plus
schedule_minutes. Use trigger="manual" if they want to run it themselves.

Set run_now=true so the first run happens immediately and they can see whether
the instructions actually produce what they wanted.

## 3. Report honestly

Tell them what it will do, when it will next run, and what the first run
returned. If the first run failed or returned something unhelpful, say so and
offer to reword the instructions — a scheduled automation that quietly produces
junk every morning is worse than none.
`,
  },
  {
    folder: 'search-my-notes',
    content: `---
name: search-my-notes
description: Answer from the user's own indexed documents and notes rather than the web
when_to_use: The user asks about their own notes, documents, or something they wrote
tools: [rag_query, rag_list, rag_index]
---

# Search my notes

## 1. Check what is indexed

Call rag_list first. If it is empty, tell the user nothing has been indexed yet
and offer to index a file or folder with rag_index. Do not silently fall back
to a web search — answering from the internet when they asked about their own
notes is a wrong answer, not a partial one.

## 2. Search

Call rag_query with the user's question. Ask for 4 chunks unless they want
depth.

## 3. Answer

- Quote the relevant lines and name the file each came from.
- If the chunks do not answer the question, say which files you searched and
  that the answer is not in them. Offer to index more.
- Never blend a note's content with general knowledge without saying which is
  which.
`,
  },
];

/**
 * Write any missing seed skills. Never overwrites — a user edit wins forever.
 * Returns how many were created, for the startup log.
 */
export function seedSkills(): number {
  let created = 0;
  try {
    const root = skillsDir();
    fs.mkdirSync(root, { recursive: true });

    for (const seed of SEEDS) {
      const dir = path.join(root, seed.folder);
      const file = path.join(dir, 'SKILL.md');
      if (fs.existsSync(file)) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, seed.content, 'utf-8');
      created++;
    }
  } catch (e) {
    // Non-fatal: skills are an enhancement, not a requirement to start.
    console.error('[SKILLS] Could not seed bundled skills:', e);
  }
  return created;
}
