import { test as base, expect as baseExpect } from '@playwright/test';
import { waitForUi5 } from '../core/waits';
import { ui5Matchers } from '../core/matchers';
import { captureControlTree } from '../core/diagnostics';
import { SelfHealingResolver } from '../core/SelfHealingResolver';
import { startApiCapture } from '../core/apiCapture';
import type { HealEvent } from '../core/types';

/**
 * Drop-in replacement for `@playwright/test`'s `test`. The `page` fixture it provides
 * opportunistically waits for the UI5 busy-state to clear after every full page load, so
 * you get a head start on auto-waiting even before your first explicit locator interaction.
 *
 * ```ts
 * import { test, expect } from 'playwright-sapui5';
 *
 * test('loads the cart', async ({ page }) => {
 *   await page.goto('https://example.com/cart');
 *   // page has already settled past the initial busy indicator here
 * });
 * ```
 *
 * `base.extend({ ... })` is Playwright's own mechanism for customizing fixtures - `base` here is
 * the *real* `test` from `@playwright/test`, imported under a different local name (`test as
 * base`) purely so this file can also export its own thing called `test` without a naming clash.
 * `.extend()` returns a new `test` that behaves exactly like `base` for anything you don't
 * override - only the `page` fixture is customized below; every other fixture (`context`,
 * `browser`, `request`, ...) passes straight through unchanged.
 */
export const test = base.extend<{
  ui5Diagnostics: void;
  ui5HealthTracking: void;
  ui5ApiCatalog: void;
}>({
  // Fixtures in Playwright are written as `async ({ dependencies }, use) => { ... }` - `{ page }`
  // here destructures the *original*, unmodified `page` fixture (this is why the parameter name
  // matches the property being overridden - Playwright resolves it from the base fixture, not
  // from this new one being defined), and `use` is how you hand a value to the test that asked
  // for it. Whatever runs before `await use(...)` is setup; whatever would run after it (nothing,
  // here) would be teardown, after the test finishes.
  page: async ({ page }, use) => {
    // `page.on('load', ...)` registers a listener that fires after every full page navigation
    // completes - not just the first one, every one, for the lifetime of this `page`. The
    // callback deliberately isn't `await`ed: it fires-and-forgets a background `waitForUi5` call
    // rather than blocking navigation on it, since `waitForUi5` can be slow and this is only
    // meant to be a head start, not a guarantee.
    page.on('load', () => {
      waitForUi5(page, { timeout: 5000 }).catch(() => {
        /* best-effort only - never fail a test because of this background wait */
      });
    });
    // Hand the (event-listener-augmented, but otherwise identical) `page` to the test.
    await use(page);
  },

  /**
   * Attaches the SAPUI5 control tree to any test that fails.
   *
   * `[fixtureFn, { auto: true }]` is Playwright's way of saying "run this for every test, even
   * though nothing asked for it by name" - so this needs no opt-in and no change to existing
   * tests. Everything before `await use()` is setup (nothing here); everything after is teardown,
   * which by then can read `testInfo.status`.
   *
   * Why this is worth doing automatically: when a locator fails, Playwright tells you what *isn't*
   * on the page (`resolved to 0 elements`) and shows you a screenshot. Neither answers the
   * question you actually have with a UI5 app - *which controls were there, of what type, with
   * what text?* - because a SAPUI5 control's identity lives in its control tree, not in the DOM
   * or in a picture of it. Recovering that by hand means re-running with `--headed`, pausing at
   * exactly the right moment, and poking at `sap.ui.getCore()` in a console. Attaching it here
   * means it's just in the report, for the run that already failed.
   */
  ui5Diagnostics: [
    async ({ page }, use, testInfo) => {
      await use();

      // `expectedStatus` rather than a literal 'passed': a test marked `test.fail()` is *supposed*
      // to fail, and dumping diagnostics for it would be noise.
      if (testInfo.status === testInfo.expectedStatus) return;

      const { dump, text } = await captureControlTree(page);
      await testInfo.attach('ui5-control-tree.txt', { body: text, contentType: 'text/plain' });
      if (dump.length > 0) {
        await testInfo.attach('ui5-control-tree.json', {
          body: JSON.stringify(dump, null, 2),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],

  /**
   * Collects every self-heal that happened during this test and attaches them - even on a
   * *passing* test, deliberately: a heal means the primary locator strategy didn't match and a
   * fallback caught it, which is worth knowing about whether or not it happened to also be the
   * difference between pass and fail this run. `HealthReporter` (see
   * `src/integrations/HealthReporter.ts`) reads this attachment to aggregate heals across a whole
   * CI run into one "these locators need attention" summary - see docs/locator-health.md.
   *
   * `SelfHealingResolver.onHeal` is a process-wide subscription, so this subscribes fresh and
   * unsubscribes at the end of every single test - Playwright runs one test at a time per worker,
   * so there's no risk of one test's heals leaking into another's attachment.
   */
  ui5HealthTracking: [
    // Playwright's fixture signature always takes this first "dependencies" object, even for a
    // fixture like this one that needs none of them - `SelfHealingResolver.onHeal` works
    // regardless of `page`/etc. eslint-disable-next-line is for that empty `{}`, not a mistake.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const heals: HealEvent[] = [];
      const unsubscribe = SelfHealingResolver.onHeal((event) => heals.push(event));
      await use();
      unsubscribe();

      if (heals.length > 0) {
        await testInfo.attach('ui5-heals.json', {
          body: JSON.stringify(heals),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],

  /**
   * Records this test's real API traffic (filtered to JSON/XML/multipart, business-looking
   * responses - see `defaultApiCallFilter` in `src/core/apiCapture.ts`) and attaches it, so
   * `ApiCatalogReporter` (`src/integrations/ApiCatalogReporter.ts`) can turn a whole run's worth
   * of real user journeys into an API catalog - see docs/api-catalog.md.
   *
   * Started before the test body runs, the same "install before navigation" rule as this
   * framework's own bridge (see docs/auto-wait.md), so bootstrap-time calls are caught too. Cost
   * is small and bounded: the filter runs on headers alone before any response body is read, so
   * only genuinely matching (typically business-data) responses cost anything at all - see
   * docs/api-catalog.md#overhead if you want to disable it anyway.
   */
  ui5ApiCatalog: [
    async ({ page }, use, testInfo) => {
      const capture = startApiCapture(page);
      await use();

      if (capture.calls.length > 0) {
        await testInfo.attach('ui5-api-calls.json', {
          body: JSON.stringify(capture.calls),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});

// `baseExpect.extend({ ... })` is the exact same mechanism as `base.extend({ ... })` above, just
// for assertions instead of fixtures - it returns a new `expect` that behaves exactly like
// Playwright's own for every built-in matcher (`toBeVisible`, `toHaveText`, ...), plus the three
// new ones `ui5Matchers` adds (`toHaveUi5Property`, `toHaveUi5Text`, `toBeUi5Busy`) - see
// docs/expect-matchers.md, and the type-level half of this in `src/core/matchers.ts`'s
// `declare module '@playwright/test'` block.
export const expect = baseExpect.extend(ui5Matchers);
