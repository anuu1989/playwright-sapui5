import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * These tests run against SAP's own public "Shopping Cart" SAPUI5 demo app - a real, live
 * SAPUI5 application, not a mock. They exist to prove the framework works end-to-end, and to
 * double as runnable documentation of how to use it.
 *
 * `test.describe('...', () => { ... })` groups related tests under one shared name - purely
 * organizational (it shows up as a heading in Playwright's reporter output), it doesn't share
 * any state between the tests inside it. Each `test(...)` call below still gets its own fresh
 * `page` (a brand new, isolated browser tab and context) - nothing that happens in one test
 * leaks into another, even within the same `describe` block.
 */
test.describe('SAPUI5 Shopping Cart demo', () => {
  // `async ({ page }) => { ... }` - the object being destructured here is Playwright's fixtures.
  // `page` is provided automatically by the `test` you imported (from `'../../src'`, this
  // framework's own drop-in for `@playwright/test`'s `test` - see src/fixtures/test.ts); you
  // never construct a `page` yourself.
  test('loads the product catalog with its category list', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // `expect(await cart.categoryList.resolve()).toBeVisible()` - reading this left to right:
    // `.resolve()` turns the `Ui5Locator` into a plain Playwright `Locator` (that's the `await`
    // - resolving involves a browser round trip); `expect(...)` then wraps that `Locator` in
    // Playwright's own assertion helper, and `.toBeVisible()` is itself async under the hood
    // (Playwright auto-retries visibility assertions for a few seconds before failing) - which
    // is why the whole `expect(...).toBeVisible()` line needs its own `await` too.
    await expect(await cart.categoryList.resolve()).toBeVisible();
    await expect(await cart.category('Laptops').resolve()).toBeVisible();
    await expect(await cart.searchField.resolve()).toBeVisible();
  });

  test("selecting a category navigates to that category's products", async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    await cart.selectCategory('Laptops');

    await expect(await cart.product('Astro Laptop 1516').resolve()).toBeVisible();
  });

  test('adding a promoted item to the cart shows a confirmation toast', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    await cart.firstAddToCartButton.click();

    // SAPUI5's MessageToast is a transient, unmanaged popup - it never becomes a UI5 "control"
    // with an id we can look up, so this is the framework's escape hatch: a plain Playwright
    // locator still benefits from being awaited the same way as everything else in a test.
    // `page.getByText(...)` is Playwright's own built-in locator (nothing from this framework
    // involved), and `/added to your shopping cart/i` is a JavaScript regular expression - the
    // trailing `i` means "case-insensitive," so it matches regardless of exact capitalization.
    await expect(page.getByText(/added to your shopping cart/i)).toBeVisible();
  });
});
