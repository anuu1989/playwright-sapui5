import { test, expect } from '../../src';
import { ui5, Ui5Navigation, Ui5Performance } from '../../src';
import { CartPage } from '../pages/CartPage';

const CART_URL = 'https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html';

/**
 * Demonstrates `Ui5Performance` (how long the app really takes to become usable) and
 * `Ui5Navigation` (jumping straight to a route instead of clicking there). See
 * docs/performance.md and docs/navigation.md.
 */
test.describe('Performance and navigation', () => {
  test('measures how long the app takes to become usable, not just to load', async ({ page }) => {
    const timings = await Ui5Performance.measureBootstrap(page, CART_URL);

    // The point of measuring this at all: the browser considers the page loaded long before the
    // app is usable. UI5 bootstraps *after* `load` - pulling in library modules, instantiating a
    // component, loading views, resolving OData metadata - so these two numbers are genuinely
    // different things, usually by an order of magnitude.
    expect(timings.settledMs).toBeGreaterThan(timings.metrics.loadEventMs ?? 0);

    // Milestones are ordered: navigation completes, then the UI5 core is ready, then the app
    // settles.
    expect(timings.coreReadyMs).toBeGreaterThanOrEqual(timings.navigationMs);
    expect(timings.settledMs).toBeGreaterThanOrEqual(timings.coreReadyMs);

    // Generous upper bound - this asserts the app isn't pathologically slow, without being a
    // flaky benchmark tied to one machine's speed.
    expect(timings.settledMs).toBeLessThan(30000);

    // How much UI5 pulled in, and how many controls it built. `controlCount` is the one worth
    // watching over time: a view that quietly starts rendering thousands of controls is a classic
    // cause of a Fiori app turning sluggish.
    expect(timings.metrics.ui5ResourceCount ?? 0).toBeGreaterThan(0);
    expect(timings.metrics.controlCount ?? 0).toBeGreaterThan(0);
  });

  test('jumps straight to a route instead of clicking through to it', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    expect(await Ui5Navigation.hash(page)).toBe('');

    // One line instead of a click-through - which matters when many tests need the same deep
    // starting state. Goes through the app's own router, so its matched-route handlers and view
    // loading run exactly as they would for a user (unlike assigning location.hash, which only
    // looks the same).
    await Ui5Navigation.navTo(page, 'category', { id: 'LT' });

    expect(await Ui5Navigation.hash(page)).toBe('#/category/LT');
    // `controlType` scopes to the product row itself rather than also matching its nested title
    // span - the same ambiguity `examples/pages/CartPage.ts` documents.
    await expect(
      await ui5(page).text('Astro Laptop 1516', { controlType: 'sap.m.ObjectListItem' }).resolve(),
    ).toBeVisible();
  });

  test('waitForHash turns a silent routing no-op into a real failure', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    await Ui5Navigation.navTo(page, 'category', { id: 'LT' });
    expect(await Ui5Navigation.waitForHash(page, '/category/LT')).toContain('/category/LT');

    // SAPUI5's own navTo logs an error and does nothing for a route that doesn't exist - it
    // doesn't throw. So the navigation silently fails, and only a hash check catches it.
    await Ui5Navigation.navTo(page, 'noSuchRouteName');
    await expect(
      Ui5Navigation.waitForHash(page, '/noSuchRouteName', { timeout: 1500 }),
    ).rejects.toThrow(/hash did not match/);
  });
});
