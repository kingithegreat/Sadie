# HomeBot user-testing checklist (REL-2)

The code is complete. These are the checks only Aden can do: they need his PC,
his accounts or keys, his voice, or his visual approval. Agents must not do them
for him or spend money on his behalf.

How to use it: work through each item and mark **PASS** or **FAIL**. On a FAIL,
note what you saw (a screenshot helps) and open a GitHub issue titled
`REL-2: <item> failed`, or tell an agent. HomeBot's diagnostics output and log files are the most useful
attachments.

Build under test: the Windows installer artifact `homebot-windows-installer` from
the **Preflight and Build (Release)** workflow run on current `main`.

---

## 1. Fresh install on a clean Windows profile

1. Create a new local Windows user (or use one that has never run HomeBot) and sign in to it.
2. Download and run `HomeBot-Setup-*.exe`. Accept the SmartScreen prompt if one appears (the test build is unsigned).
3. Launch HomeBot from the Start menu and go through first-run setup with the defaults.
4. Send one chat message and get a reply. Open Code, Media Studio and Settings once each.
5. Quit HomeBot from the tray, then confirm it is no longer running in Task Manager.

- [ ] PASS  - [ ] FAIL — notes:

## 2. Voice: microphone transcription and narration

1. In Settings, allow the microphone. Keep **Online** off for this first part.
2. Use the mic button and say a full sentence. The words appear correctly in the composer.
3. Ask HomeBot to read its reply aloud (narration/TTS) and confirm you hear it clearly, with no cut-offs.

- [ ] PASS  - [ ] FAIL — notes:

## 3. Pro paid path

1. On the Free tier, open the Automation Center and confirm Pro features are clearly locked, with an upgrade prompt.
2. Complete the real purchase/licence flow you intend customers to use (see `docs/SELLING_AND_LICENSING.md`). Use your own production signing key, not the repo's default keypair.
3. Activate the licence key in HomeBot. Pro unlocks: create, run and delete one automation.
4. Restart HomeBot and confirm Pro is still active.

- [ ] PASS  - [ ] FAIL — notes:

## 4. PROV-3: one live image with your OpenAI key

1. In Settings → API keys, enter your own OpenAI key. This costs a few cents.
2. In chat, ask for one image, with free engines unavailable or disabled so the paid step is reached.
3. Confirm HomeBot shows the paid-generation disclosure and asks you to confirm first.
4. An image appears, and the reported cost looks plausible (a few cents).

- [ ] PASS  - [ ] FAIL — notes:

## 5. IDE-6: tab-complete speed

1. With Online on, let HomeBot install the small local coder model it suggests for tab completion, or use one already in Ollama.
2. Open a project in Code and type in a TypeScript file for a few minutes.
3. Ghost text appears, Tab accepts it, and it feels fast enough to keep on. Record the p50 latency HomeBot reports.
4. Remove or stop the model: completion turns off and shows setup guidance.

- [ ] PASS  - [ ] FAIL — p50 latency: ____ ms — notes:

## 6. Leila art approval and the six-second rig proof (MS-RIG-0)

1. Review the approved-candidate Leila artwork and approve it or request changes.
2. Watch the six-second 1920×1080, 30 fps proof export (captions off). Check: torso still, elbow bends, shoulder and wrist stay attached, expression changes without jumping, prop stays in hand, no duplicate limbs, gaps, clipping or overlap.

- [ ] PASS  - [ ] FAIL — notes:

## 7. Flappy anchor

1. Open Media Studio → Character Anchor Workbench and select **Flappy**.
2. Check Flappy's hand-placed head box and mouth anchors. Use "suggest" for any missing ones, adjust them if needed and save.
3. In a short render or preview, Flappy's mouth and head line up on the anchors in every pose.

- [ ] PASS  - [ ] FAIL — notes:

## 8. One full narrated episode

1. Only after items 6 and 7 pass: make one complete Ancient Pathways episode with narration in Media Studio.
2. Watch it end to end. The narration is in sync and audible, the visuals are correct, there are no frozen or black frames, and the captions (if on) match.
3. Confirm the finished file is in the Finished folder and plays in a normal video player.

- [ ] PASS  - [ ] FAIL — notes:

---

When all eight items pass, REL-1 and REL-2 can be closed in `docs/USER_TESTING_PLAN.md`.
