import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates multi-step navigation and Page Object composition - `CartPage.selectCategory()`
 * returns a `CategoryPage`, and `CategoryPage.openProduct()` returns a `ProductDetailPage`. See
 * docs/page-objects.md#composing-page-objects.
 */
test.describe('Product detail', () => {
  // The `async ({ page }) => { ... }` callback here is written across multiple lines - unlike the
  // single-line arrow functions in the other example files - purely because the test's *name*
  // string is long enough that keeping `async ({ page }) => {` on the same line would run past a
  // comfortable line width. This is exactly the kind of thing an auto-formatter (this project
  // uses Prettier - see the README) decides for you; the code means the same thing either way.
  test('opening a product from a category shows its detail and adds it to the cart', async ({
    page,
  }) => {
    const cart = new CartPage(page);
    await cart.open();

    // `selectCategory` and `openProduct` are both `async` methods returning a *different* Page
    // Object each time (`CategoryPage`, then `ProductDetailPage`) - each one representing
    // "wherever clicking just took you." `category` and `detail` below are ordinary local
    // variables (TypeScript infers their types automatically from what each method returns - see
    // docs/typescript-for-beginners.md#type-annotations-on-variables - so there's no need to
    // write `const category: CategoryPage = ...` by hand).
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
