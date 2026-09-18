import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates a data-driven test: the same steps run once per entry in a plain array, instead
 * of copy-pasting one test per category. This is an ordinary Playwright/JavaScript pattern - a
 * `for` loop that calls `test(...)` - nothing framework-specific, but it's a technique worth
 * having an example of.
 */
const categoriesToCheck = ['Laptops', 'Printers', 'Mice'];

for (const categoryName of categoriesToCheck) {
  test(`the "${categoryName}" category shows at least one product`, async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    const category = await cart.selectCategory(categoryName);

    await expect(await category.title.resolve()).toBeVisible();
    expect(await category.products.count()).toBeGreaterThan(0);
  });
}
