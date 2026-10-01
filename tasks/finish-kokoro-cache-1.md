# FINISH-KOKORO-CACHE-1: persist voice models outside the application archive

When the installed app loaded Kokoro, Transformers selected its default
filesystem cache beside the library inside `resources/app.asar`. ASAR is
read-only, so this location cannot retain newly downloaded voice weights for an
offline restart. Both the model and tokenizer now receive
`userData/models/kokoro` through their existing per-load `cache_dir` option.
Online consent remains per-load (`local_files_only`); no runtime-wide cache or
network policy is mutated, and the same Kokoro CJS runtime/Tensor classes remain.

## Reproduction and checks

- Read-only actual unmodified main `861c11be` package inspection:
  `C:/Users/adenk/.homebot/finish-package-refresh-20261001/.kilo/package-evidence/voice-cache-path-861c11be-1790820683531/evidence.json`.
  `useFSCache` was true and `cacheDir` was inside the application archive.
- Installed Transformers source selects `options.cache_dir ?? env.cacheDir`.
  Electron documents ASAR's read-only limitation:
  <https://www.electronjs.org/docs/latest/tutorial/asar-archives#archives-are-read-only>.
- Baseline regression: three cache/profile assertions failed, one disposal case
  passed, before changing the loader. Log `.kilo/cache-proof/baseline-jest.log`.
  An earlier command used a nonexistent Jest config path and stopped before tests;
  the corrected command uses the repository's actual `widget/jest.config.ts`.
- Fixed affected voice checks: 3 suites / 28 tests passed, including consent,
  both loaders, distinct profile caches, unchanged global default, failure
  disposal and existing narration/privacy behavior. Separate widget typecheck,
  changed-file ESLint (zero errors), docs drift and production release build
  passed. Log `.kilo/cache-proof/fixed-jest.log`.
- Actual production-built visible Record narration, original model/tokenizer
  methods observed and delegated without replacement: both received the owned
  profile cache and `local_files_only: true`. The missing-model guidance remained
  actionable. A location-only marker proved the selected cache is writable and
  survives native close/restart; original script stayed intact. Runtime default
  was unchanged. Six stages passed; screenshot inspected. All 73 copied compiled
  files match their source build by SHA-256. Evidence:
  `.kilo/cache-proof/built-cache-1790821136582/evidence.json`.

No weights were downloaded or faked, and no narration success or listening
quality is claimed. The marker is a location proof, not model metadata. HOME,
userData, projects, AP and MCP stores were isolated; the copied runtime also
isolates the development RAG store. Native dependencies were reused read-only
only after all four package manifests/lockfiles matched. No junction rebuild.
Actual new packaged behavior, live weight download, successful offline narration
and owner A/V acceptance remain separate gates. Current delivered `861c11be`
installer predates this fix; refresh only after verified serial integration.

## Release state

Source implementation ready for independent CI/integration. Root owns this lane;
held #417 and the sole Ancient Pathways owner remain separate. No model download,
AP edit/render, owner profile, credential, account, signing or publication change.
