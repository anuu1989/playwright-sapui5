import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates accessibility testing with axe-core - see docs/accessibility.md.
 */
test.describe('Accessibility', () => {
  test('the welcome page has no new accessibility violations beyond its known baseline', async ({
    page,
  }, testInfo) => {
    const cart = new CartPage(page);
    await cart.open();

    const results = await new AxeBuilder({ page }).analyze();

    // Attach full results to the HTML report, regardless of pass/fail, so violations are easy to
    // inspect without re-running anything.
    await testInfo.attach('axe-violations', {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });

    // This public demo app (SAP's own, not this framework's code) has a handful of pre-existing
    // accessibility issues this suite doesn't control. Baselining the known count here catches
    // *new* regressions without blocking on fixing issues that aren't this test's to fix - a
    // common, realistic pattern for adopting a11y testing on an app with existing debt. On your
    // own app, drive this number toward (and keep it at) zero as you fix what axe finds.
    const KNOWN_BASELINE_VIOLATIONS = 4;
    expect(results.violations.length).toBeLessThanOrEqual(KNOWN_BASELINE_VIOLATIONS);
  });
});
