import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates multi-step navigation and Page Object composition - `CartPage.selectCategory()`
 * returns a `CategoryPage`, and `CategoryPage.openProduct()` returns a `ProductDetailPage`. See
 * docs/page-objects.md#composing-page-objects.
 */
test.describe('Product detail', () => {
  test('opening a product from a category shows its detail and adds it to the cart', async ({
    page,
  }) => {
    const cart = new CartPage(page);
    await cart.open();

    const category = await cart.selectCategory('Laptops');
    const detail = await category.openProduct('Astro Laptop 1516');

    await expect(await detail.title('Astro Laptop 1516').resolve()).toBeVisible();

    await detail.addToCart();

    await expect(page.getByText(/added to your shopping cart/i)).toBeVisible();
  });

  test('the back button returns from a category to the full category list', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    const category = await cart.selectCategory('Laptops');
    await expect(await category.title.resolve()).toBeVisible();

    await category.goBack();

    // Back at the top-level category list - "Laptops" is a category entry again, not a page title.
    await expect(await cart.category('Laptops').resolve()).toBeVisible();
  });
});
