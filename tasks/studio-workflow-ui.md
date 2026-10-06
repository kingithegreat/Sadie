# Media Studio workflow and UI

Implemented from main `7951c205` in the isolated Studio workflow worktree.

Project creation now retains a title after a refused or unavailable save,
prevents repeated pending submissions, preserves a newer draft and focuses the
saved project's next action. Failed/blocked projects can resume their recorded
interrupted stage through the existing validated IPC; unknown history and saved
movie review entries cannot invent a recovery stage. Recovery does not generate,
approve or publish. Rejected and published projects have separate sections and
are excluded from suggested work.

The start screen prioritizes review/next actions and visible project creation.
Secondary tools use native keyboard buttons inside a disclosure and load their
workspace content. Navigation uses Projects, Timeline and Stage; unsupported
vendor badges and unloaded counts are removed. Styles follow the current theme,
wrap long actions and adapt at narrower widths.

## Verification

- Creation regression baseline reproduced title loss and duplicate submissions.
- TypeScript, scoped lint, fresh Electron build and all 18 affected Studio
  suites / 201 tests passed, none skipped.
- Real Electron acceptance passed 1/1, zero retries: saved project creation,
  actual failed-job state recovery on disk, next-action focus, keyboard tool
  opening/content loading, visible initial title field, narrow Studio overflow,
  exclusive media playback, explicit voice playback, missing-file errors,
  fullscreen/Escape and narration-clock animatic transport.
- Desktop and narrow-window screenshots inspected. The unchanged compiled
  baseline placed creation below the initial viewport; the final build shows it.
- First recovery acceptance used an incorrect expected button label; this was
  corrected to the missing narration action before the passing complete run.
- Initial hosted UI checks identified stale expectations for removed vendor
  badges, old approval wording and the renamed Storyboard tool. The theme and
  visual specs now check all four real workflow count labels, current approval
  guidance and the reachable tool disclosure. Final hosted checks must qualify
  this follow-up head; a rerun of the old assertions is not a resolution.
- Final local theme/visual follow-up passed 2/2 with zero retries against the
  accepted compiled copy, including dark/light theme checks and Storyboard entry.
  Its initial run timed out and required cleanup of the identified owned runner;
  both specs now use the existing bounded Electron-close helper. The final run
  closed naturally within its budget. Evidence: `workflow-theme-bounded-results`
  and `workflow-theme-bounded-junit.xml`; the earlier run remains retained.
- Review identified a real expanded-menu grid regression: the inherited icon
  column constrained tool descriptions to 32px. The compiled baseline reproduced
  that exact width. A scoped three-class override now allocates the card width to
  text and an auto-sized arrow; all five tool text widths exceed 100px. The new
  complete workflow/playback acceptance passed 1/1 with zero retries, and the
  expanded-menu screenshot was inspected. Final native evidence is
  `workflow-tools-fixed-results`; its baseline is `workflow-tools-baseline-results`.
  Repeated dark/light theme and visual checks after the CSS fix passed 2/2 with
  zero retries: `workflow-tools-theme-results` and `workflow-tools-theme-junit.xml`.

Evidence: `C:/Users/adenk/.homebot/workflow-ui-tests.json`,
`workflow-ui-baseline-results`, `workflow-ui-compact-results` (intermediate),
and `workflow-ui-final-results` (accepted compiled run).

Fixtures use an isolated profile and local encoded media with providers/network
denied. This proves workflow/playback behavior, not generated speech, artistic
quality or a new installed release. Global HomeBot header layout and the
concurrent IDE completion scope are outside this focused Studio change.

Source editing is released to root integration. Hosted current-head CI, configured
review, landing and separate launchable delivery remain pending at this commit;
final receipts belong in the canonical Drive plan.
