import { test, expect } from '../../src';
import { ui5, SelfHealingResolver } from '../../src';

/**
 * Demonstrates the framework's self-healing behaviour in isolation - see
 * docs/locators.md#self-healing-fallback-strategies.
 */
test.describe('Self-healing locators', () => {
  test('falls back to a working strategy and reports the heal when the primary one breaks', async ({
    page,
  }) => {
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    const healed: string[] = [];
    const unsubscribe = SelfHealingResolver.onHeal((event) => {
      healed.push(`fallback #${event.attempt}: ${JSON.stringify(event.strategy)}`);
    });

    // The primary strategy below targets an id that has never existed - standing in for a
    // control someone renamed after this locator was written. The fallback still finds the real
    // "Laptops" category item by its control type + visible text, so the click succeeds anyway.
    const laptopsCategory = ui5(page)
      .id('this-id-was-renamed-or-removed')
      .fallback({ by: 'text', text: 'Laptops', controlType: 'sap.m.StandardListItem' })
      .as('Laptops category (deliberately broken primary strategy)');

    await laptopsCategory.click({ timeout: 3000 });

    // The click worked (no exception above), and exactly one heal event fired for it.
    expect(healed).toHaveLength(1);
    expect(healed[0]).toContain('"by":"text"');

    unsubscribe();
  });

  test('throws a clear error when every strategy fails', async ({ page }) => {
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    const brokenLocator = ui5(page)
      .id('nothing-matches-this')
      .fallback({ by: 'controlType', controlType: 'sap.m.ThisControlTypeDoesNotExist' })
      .as('Completely broken locator');

    await expect(brokenLocator.click({ timeout: 1000 })).rejects.toThrow(
      /All 2 locator strategies failed/,
    );
  });
});
