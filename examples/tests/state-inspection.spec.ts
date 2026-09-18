import { test, expect } from '../../src';
import { ui5 } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates reading state without acting on it: `.isVisible()`, `.isEnabled()`, `.count()`.
 * Useful for assertions that don't fit `expect(locator).toBeVisible()` directly - e.g. asserting
 * on a computed condition, or logging state for debugging. Also shows mixing a Page Object with
 * the standalone `ui5(page)` helper in the same test - both return the same `Ui5Locator` type,
 * so they compose freely.
 */
test.describe('Reading control state', () => {
  test('visibility, enabled state, and counts', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    expect(await cart.categoryList.isVisible()).toBe(true);
    expect(await cart.searchField.isEnabled()).toBe(true);

    // Every category row, found directly with the fluent helper instead of a Page Object getter.
    const categoryCount = await ui5(page).controlType('sap.m.StandardListItem').count();
    expect(categoryCount).toBeGreaterThan(10);

    // A locator for something that was never on this page resolves to 0, not an error.
    const missing = ui5(page).text('This text does not appear anywhere on this page');
    expect(await missing.count({ timeout: 1000 })).toBe(0);
    expect(await missing.isVisible({ timeout: 1000 })).toBe(false);
  });
});
