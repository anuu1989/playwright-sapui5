import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * These tests run against SAP's own public "Shopping Cart" SAPUI5 demo app - a real, live
 * SAPUI5 application, not a mock. They exist to prove the framework works end-to-end, and to
 * double as runnable documentation of how to use it.
 */
test.describe('SAPUI5 Shopping Cart demo', () => {
  test('loads the product catalog with its category list', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

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
    await expect(page.getByText(/added to your shopping cart/i)).toBeVisible();
  });
});
