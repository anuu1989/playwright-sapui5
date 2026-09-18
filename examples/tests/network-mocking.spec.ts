import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates network mocking with Playwright's own `page.route()` - a plain Playwright
 * feature, not something this framework adds, but combined here with UI5-aware locators to show
 * the two working together. This is the standard way to test empty states, error states, or
 * specific edge-case data that's inconvenient (or impossible) to set up in a real backend.
 *
 * Route registration must happen *before* navigation - same rule, and same reason, as installing
 * the UI5 bridge before `page.goto()`
 * (see docs/auto-wait.md#the-ordering-gotcha-bridge-installation-vs-navigation).
 */
test.describe('Network mocking', () => {
  test('mocking the categories endpoint controls what the app shows', async ({ page }) => {
    await page.route('**/localService/mockdata/ProductCategories.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { CategoryName: 'Mocked Category', Category: 'MK', NumberOfProducts: 1 },
        ]),
      }),
    );

    const cart = new CartPage(page);
    await cart.open();

    // The app is rendering our fake data, not the real backend's.
    await expect(await cart.category('Mocked Category').resolve()).toBeVisible();
    expect(await cart.category('Laptops').count()).toBe(0);
  });
});
