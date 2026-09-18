import { test as base, expect } from '@playwright/test';
import { waitForUi5 } from '../core/waits';

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
export const test = base.extend({
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
});

export { expect };
