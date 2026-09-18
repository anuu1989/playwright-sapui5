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
    // `page.route(urlPattern, handler)` intercepts any request whose URL matches `urlPattern`
    // (a glob pattern here - `**` matches across path segments) *before* it ever reaches the real
    // network. `handler` receives a `route` object representing that one intercepted request;
    // `route.fulfill({...})` responds to it directly, with whatever status/body you choose,
    // instead of letting the browser's real request go out at all.
    await page.route('**/localService/mockdata/ProductCategories.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        // The real endpoint returns an array of `{ CategoryName, Category, NumberOfProducts }`
        // objects - this fake response follows that exact same shape (with different data)
        // specifically so the app's own SAPUI5 data-binding code has no idea it isn't real.
        body: JSON.stringify([
          { CategoryName: 'Mocked Category', Category: 'MK', NumberOfProducts: 1 },
        ]),
      }),
    );

    const cart = new CartPage(page);
    await cart.open();

    // The app is rendering our fake data, not the real backend's.
    await expect(await cart.category('Mocked Category').resolve()).toBeVisible();
    // `.count()` (rather than an assertion like `.toBeVisible()`) is the right tool for proving
    // something is genuinely *absent* - it resolves to a plain number (`0` here) instead of
    // retrying and eventually timing out the way a "this should be visible" assertion would if
    // pointed at something that will never appear.
    expect(await cart.category('Laptops').count()).toBe(0);
  });
});
