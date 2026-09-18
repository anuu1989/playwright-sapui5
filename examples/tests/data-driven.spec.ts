import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates a data-driven test: the same steps run once per entry in a plain array, instead
 * of copy-pasting one test per category. This is an ordinary Playwright/JavaScript pattern - a
 * `for` loop that calls `test(...)` - nothing framework-specific, but it's a technique worth
 * having an example of.
 */
const categoriesToCheck = ['Laptops', 'Printers', 'Mice'];

// This `for` loop runs when the test *file* is first loaded, before any test actually executes -
// it's not something that happens "during" a test. Each iteration calls `test(...)` once, which
// registers one more test with Playwright's runner; by the time the loop finishes, three
// completely independent tests exist (visible individually in `npx playwright test --list`, and
// in the reporter output, each with the category name baked into its title), not one test that
// internally loops three times. That distinction matters: if the "Printers" iteration failed,
// "Laptops" and "Mice" would still be reported as their own separate pass/fail results.
for (const categoryName of categoriesToCheck) {
  // The backtick string below is a *template literal* used for the test's name, not its body -
  // `${categoryName}` is substituted with the current loop value each time, producing titles
  // like `the "Laptops" category shows at least one product`.
  test(`the "${categoryName}" category shows at least one product`, async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // `categoryName` here is the loop variable from the outer `for` - captured by the arrow
    // function passed to `test(...)`, exactly the same way any JavaScript closure captures a
    // variable from its surrounding scope. Because this loop uses `const categoryName of ...`
    // (not `var`), each iteration gets its own independent binding, so every one of the three
    // tests correctly remembers its own category rather than all three ending up pointed at
    // whatever the loop variable was on its last pass.
    const category = await cart.selectCategory(categoryName);

    await expect(await category.title.resolve()).toBeVisible();
    // `.count()` returns a plain `number`, so this uses a regular `expect(...).toBeGreaterThan(0)`
    // rather than the `await expect(locator).toBeVisible()` style seen elsewhere - there's no
    // element to retry-and-wait for here, just a value to check once it's been read.
    expect(await category.products.count()).toBeGreaterThan(0);
  });
}
