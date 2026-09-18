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

    await cart.searchField.fill('Note');
    await page.keyboard.press('Enter');

    await expect(await cart.product('Notebook Basic 15').resolve()).toBeVisible();
  });
});
