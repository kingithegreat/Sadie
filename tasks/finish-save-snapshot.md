# FINISH-SAVE-SNAPSHOT-1

When a Code file is saved and edited again before the save reply arrives,
the old callback marked the newer editor text clean even though disk contained
the earlier snapshot. Closing that apparently clean tab could discard the edit.
The save acknowledgement now advances the baseline to the text actually sent.

The renderer regression failed on main `12b243e5`: the newer text stayed in
the editor and the saved snapshot reached the fixture disk, but the Unsaved
marker disappeared. The ordinary success and failed-save controls passed.
After the correction, all three tests pass, including a dirty-tab close prompt,
Cancel preservation, and a second save that writes the newer exact bytes.

Windows checks executed:

- Original affected suites: 4 suites / 20 tests passed (save, handoff, search
  shell, CodeMirror). Existing handoff suite emitted a jsdom Range layout error
  while still passing; no production issue is inferred from that output.
- After incorporating landed IDE navigation #456: 3 suites / 20 tests passed
  (save, IDE Back, Code reachability).
- Separate TypeScript, scoped ESLint and release production builds passed.
- Root docs sync and git diff whitespace checks passed.

Actual rebuilt Windows Electron proof includes landed navigation #456. It uses
the unchanged real save handler and delays only its first reply after the real
disk write. Visible CodeMirror typing, Ctrl+S, later typing, delayed reply,
Unsaved marker, Close prompt/Cancel, second save/exact disk bytes, and native
process exit pass. Screenshot inspected. Fresh disposable HOME/profile/AP/MCP
stores and five validated transport denial controls isolate the owner data.

Evidence:
`C:/Users/adenk/.homebot/finish-save-snapshot-20261002/.kilo/save-snapshot-built-1790915672759/evidence.json`
and `newer-text-unsaved.png` in the same directory. Probe source:
`.kilo/verify-save-snapshot-built.cjs` in that private checkout.

The initial built proof passed its file/dirty/prompt stages but incorrectly
expected two save calls; the existing CodeMirror and shell Ctrl+S paths make
four. That failed run remains at `save-snapshot-built-1790915537871`. The corrected
proof reports the count and asserts the real disk/UI effects. This bounded fix
does not change shortcut dispatch. It is built-app evidence, not package or
installer acceptance. Root owns required CI, serial integration and packaging.
