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
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    page.on('load', () => {
      waitForUi5(page, { timeout: 5000 }).catch(() => {
        /* best-effort only - never fail a test because of this background wait */
      });
    });
    await use(page);
  },
});

export { expect };
