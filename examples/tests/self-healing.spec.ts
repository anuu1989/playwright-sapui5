import { test, expect } from '../../src';
import { ui5, SelfHealingResolver } from '../../src';

/**
 * Demonstrates the framework's self-healing behaviour in isolation - see
 * docs/locators.md#self-healing-fallback-strategies, and docs/architecture.md#flow-3-self-healing-traced-through-a-failure
 * for exactly what code runs, step by step, to produce the behavior shown here.
 */
test.describe('Self-healing locators', () => {
  test('falls back to a working strategy and reports the heal when the primary one breaks', async ({
    page,
  }) => {
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    // `healed: string[]` - an explicit type annotation on an empty array, because TypeScript has
    // nothing to *infer* a type from yet (an empty array literal alone, `[]`, could hold anything)
    // - see docs/typescript-for-beginners.md#type-annotations-on-variables. Without this
    // annotation, TypeScript would infer `any[]`, silently losing type-checking on whatever gets
    // pushed into it later.
    const healed: string[] = [];
    // `SelfHealingResolver.onHeal(listener)` subscribes globally - every `Ui5Locator` created
    // anywhere in this test (or, if you didn't unsubscribe, in any later test too) will report
    // through this same callback. It returns an "unsubscribe" function, captured here as
    // `unsubscribe` and called at the end of this test - see the comment on `unsubscribe()` below.
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

    // `{ timeout: 3000 }` overrides the default overall budget (normally ~10-15 seconds, split
    // across strategies) down to 3 seconds total, split between the two strategies here (~1.5s
    // each) - just to keep this specific test fast, since we already know the first strategy is
    // going to fail and don't want to wait through a longer default timeout to find that out.
    await laptopsCategory.click({ timeout: 3000 });

    // The click worked (no exception above), and exactly one heal event fired for it.
    expect(healed).toHaveLength(1);
    expect(healed[0]).toContain('"by":"text"');

    // Subscriptions made with `onHeal(...)` are global and don't automatically clean themselves
    // up - without this call, the listener registered above would keep firing (and keep pushing
    // into `healed`, an array this test no longer cares about) for every other test that runs
    // afterward in the same worker process. Unsubscribing here keeps this test's side effects
    // fully contained to itself.
    unsubscribe();
  });

  test('throws a clear error when every strategy fails', async ({ page }) => {
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    const brokenLocator = ui5(page)
      .id('nothing-matches-this')
      .fallback({ by: 'controlType', controlType: 'sap.m.ThisControlTypeDoesNotExist' })
      .as('Completely broken locator');

    // `expect(promise).rejects.toThrow(pattern)` is Playwright/Jest-style syntax for asserting
    // that an `async` call fails, instead of succeeding - the opposite of the usual
    // `await expect(...).toBeVisible()` pattern used everywhere else in this test suite.
    // Deliberately *not* writing `await brokenLocator.click(...)` directly: doing that would
    // throw immediately and fail the test with an unhandled exception, rather than letting
    // `expect` observe and verify that specific failure. `.rejects` unwraps the rejected
    // `Promise` for you; `.toThrow(/pattern/)` checks the resulting error's message against a
    // regular expression rather than requiring an exact string match.
    await expect(brokenLocator.click({ timeout: 1000 })).rejects.toThrow(
      /All 2 locator strategies failed/,
    );
  });
});
