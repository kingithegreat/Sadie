# FINISH-SETTINGS-METRICS-1

Advanced Settings performance badges ran together because the existing `perf-*`
classes had no stylesheet. Adds scoped responsive row, badge, summary and trend
styles; telemetry collection, values, hints and controls are unchanged.

Actual production-built baseline at main 82c19c4e reproduced zero separation
between p50/p95 and inline summary collision. The fixed renderer separated badges
by 8px, moved the summary down 6px and fit the available width at actual viewport
widths 432 and 907 CSS pixels (Windows display scale 1.25). Both screenshots were
visually inspected. The settings route was visible Settings → Advanced →
Diagnostics & Performance. Isolated temporary HOME/profile/projects/AP and an
empty MCP list were used; owned Electron exited on native close.

Evidence:

- Baseline: `.kilo/metrics-baseline-1790814960718/evidence.json`
- Fixed: `.kilo/metrics-fixed-1790815226000/evidence.json`
- Earlier first attempt: `.kilo/metrics-baseline-1790814890977/evidence.json`
  failed while resizing an open dialog; the probe now resizes before opening it.
  Product code was not altered to bypass that harness issue.

Production build, docs sync and scoped ESLint passed. The two existing performance
renderer suites passed all six cases. No extra unit test mirrors the CSS; actual
browser geometry, responsive screenshots and the old-build control prove the
layout change. A separate widget TypeScript invocation passed with exit 0.

The current delivered 82c19c4e package is preserved. This fix needs current-head
required CI, landed-content verification and a refreshed package before it is
claimed available through that package shortcut.
