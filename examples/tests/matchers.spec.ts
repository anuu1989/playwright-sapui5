import { test, expect } from '../../src';
import { ui5 } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates the framework's custom `expect` matchers - `toHaveUi5Property`, `toHaveUi5Text`,
 * and `toBeUi5Busy` - which read a SAPUI5 control's own live property values through the bridge,
 * rather than inspecting rendered DOM text the way Playwright's built-in `toHaveText` does. See
 * docs/expect-matchers.md.
 */
test.describe('Custom UI5 matchers', () => {
  test('toHaveUi5Property reads a control property directly', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // The category list's `headerText` property is "Categories" - not scraped from the DOM, read
    // straight off the live `sap.m.List` control object.
    await expect(cart.categoryList).toHaveUi5Property('headerText', 'Categories');
  });

  test('toHaveUi5Text is a convenience shortcut for the common "what text does this show" case', async ({
    page,
  }) => {
    const cart = new CartPage(page);
    await cart.open();

    await expect(cart.category('Laptops')).toHaveUi5Text('Laptops');
  });

  test('a failing property assertion reports what it actually found', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // Deliberately wrong expected value, to prove the matcher fails - and to show its message is
    // useful, not just "assertion failed."
    await expect(
      expect(cart.categoryList).toHaveUi5Property('headerText', 'Not The Real Header', {
        timeout: 1000,
      }),
    ).rejects.toThrow(
      /Expected property "headerText" to be Not The Real Header, but it was Categories/,
    );
  });

  test('toBeUi5Busy and its .not counterpart', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // Nothing on this page is busy right after it settles - `.not.toBeUi5Busy()` uses Playwright's
    // own standard `.not` modifier, which every custom matcher gets for free.
    await expect(cart.categoryList).not.toBeUi5Busy();
  });

  test('works with a plain resolved Locator too, not just a Ui5Locator', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // `.resolve()` first, then assert on the resulting plain Playwright `Locator` - both forms
    // are accepted by these matchers.
    const resolved = await ui5(page)
      .text('Laptops', { controlType: 'sap.m.StandardListItem' })
      .resolve();
    await expect(resolved).toHaveUi5Text('Laptops');
  });
});
