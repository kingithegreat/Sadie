Usage
-----

Import and await `waitForAppReady(page)` at the start of Playwright E2E tests to replace brittle sleeps or UI-visibility assumptions.

Example
-------

```ts
import { waitForAppReady } from './helpers/appReady';

test('example', async ({ page }) => {
  await waitForAppReady(page);
  // now safe to interact with inputs and controls
});
```

Migration guidance
------------------
- Replace common `page.waitForTimeout(...)` freeloaders with `await waitForAppReady(page)`.
- If a test previously awaited a visible selector, keep that fine-grained check after `waitForAppReady` if you need to validate a specific element.
- Consider adding a stable `data-testid="sadie-app-root"` or a `data-app-ready` attribute in the renderer for the most deterministic signal.

Notes
-----
- The helper is conservative: it waits for DOM load, a stable anchor, absence of blocking overlays, and an editable input. Adjust timeouts or selectors in `appReady.ts` as needed for your app.
