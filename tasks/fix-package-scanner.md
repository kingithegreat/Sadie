# Bounded package integrity scanner

Owned lane `APP-PACKAGE-SCAN-STREAM`, based on main `794c41e`.
Media prepares only the scanner, tiny native Node fixtures and their widget
Jest wrapper; root executes
the baseline before authorizing production edits, then owns publication and
package/delivery execution. QA/release inspect the frozen diff independently.

The original scanner recursively chose the first `.asar` and materialized its
entire extracted tree to check forbidden entry names. A retained package has
both `resources/app.asar` and `resources/default_app.asar`. The prepared change
pins the actual application archive and rejects ambiguity; it checks every
payload with bounded reads, validates links and the actual unpacked files, and
retains all existing forbidden-name rejection. Official installed `@electron/asar`
parses ASAR metadata. A listing alone does not establish payload readability.

Tiny fixtures cover permitted/forbidden/nested entries, wrong or multiple
archives, truncated/malformed payload and header metadata, safe and unsafe
links, unpacked files and path escapes. A read-only filesystem control proves
the scan avoids an extracted tree. Importing testable functions must not run
the CLI. The wrapper requires explicit TAP, exactly 34 executed native controls,
zero failed/skipped controls and named positive evidence, with bounded child
timeouts. It runs in the existing widget CI test discovery without new manifests.

Root-executed evidence (source scanner frozen SHA-256
`ADF0E90A65C90C0D29B3BE1A862104F81511A1806F51C4BEFB8A72078A12183D`):

- Original baseline: 31 controls, 17 passed / 14 failed, native 1/null;
  `.kilo/scanner-baseline-1791191775604.json`.
- Directory-cycle A/B: 34 controls, 32 passed / 2 failed, native 1/null;
  `.kilo/scanner-fixed-1791192267268.json`. The safe directory alias passed;
  ancestor and sibling traversal cycles reproduced missing rejection.
- Final fixed: 34/34 passed, native 0/null, zero skipped;
  `.kilo/scanner-fixed-1791192339116.json`.
- Widget wrapper: 1/1 Jest test passed, invoking those same 34 native controls,
  native 0/null; `.kilo/scanner-widget-wrapper-1791192343467.json`.
- Retained real 2a package: 15,306 files, 17,903 entries and 936,777,992 payload
  bytes checked read-only; archive SHA-256 unchanged before/after;
  `.kilo/scanner-real-package-1791192426354.json`. This stale package compatibility
  control is not new-source app, installer, profile or delivery acceptance.

Earlier failures remain retained. Media editing is released to root. Full CI,
typecheck, publication and fresh Desktop delivery are still pending/root-owned.

No dependencies/manifests, installer, profiles, model cache, live media or other
owners' source may change. Existing native and installed ASAR dependencies are
read-only. At the initial planning snapshot, disk 3.969 GiB was below
the 5 GiB guard and the earlier approximately 7.063 GiB plus overhead delivery
planning baseline; RAM 2.147 GiB met the RAM entry floor only. Entry guards must
be measured again before heavy work. The 936,777,992 logical bytes describe
temporary extraction writes avoided, not measured physical reclamation. This
lane does not claim a fresh Desktop package or acceptance.
