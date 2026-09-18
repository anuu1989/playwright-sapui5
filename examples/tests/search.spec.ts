import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates `.fill()` on a SAPUI5 form control. `sap.m.SearchField` renders its actual
 * `<input>` nested inside the control's root element rather than as the root itself - the
 * framework detects that automatically, so `.fill()` just works. See the note on this in
 * docs/troubleshooting.md if you're curious about the mechanics.
 */
test.describe('Search', () => {
  test('typing a query and pressing Enter filters the product list', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // `cart.searchField` is a getter (see `CartPage.ts`) that returns a `Ui5Locator` with a
    // primary + fallback strategy already attached - `.fill(...)` here resolves that locator
    // (self-healing if needed), locates the underlying `<input>`, and types the text into it, all
    // in one call.
    await cart.searchField.fill('Note');
    // `.fill()` sets an input's value directly - it doesn't simulate individual keystrokes, so it
    // never triggers a "press Enter" style submit on its own. `page.keyboard.press('Enter')` is a
    // separate, explicit step: a real, page-wide keyboard event, not scoped to any one element.
    await page.keyboard.press('Enter');

    await expect(await cart.product('Notebook Basic 15').resolve()).toBeVisible();
  });
});
