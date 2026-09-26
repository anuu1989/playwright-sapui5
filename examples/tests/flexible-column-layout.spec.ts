import { test, expect } from '../../src';
import { ui5, Ui5FlexibleColumnLayout } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates `Ui5FlexibleColumnLayout` - the one/two/three-column shell behind most modern
 * Fiori apps. The Shopping Cart demo this repo uses throughout is itself built on one. See
 * docs/flexible-column-layout.md.
 */
test.describe('sap.f.FlexibleColumnLayout', () => {
  test('reads the column arrangement and which page each column shows', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // All three columns exist in the DOM at all times, sized by CSS - so "how many columns are
    // showing" is not a question the DOM can answer. The control's own `layout` enum can.
    const layout = await Ui5FlexibleColumnLayout.layout(page);
    expect(layout).toBe('TwoColumnsMidExpanded');
    expect(await Ui5FlexibleColumnLayout.visibleColumnCount(page)).toBe(2);

    const before = await Ui5FlexibleColumnLayout.currentPages(page);
    expect(before.begin).toContain('homeView');

    // Selecting a category navigates the *begin* column to a different page, while the layout
    // itself stays as it was - exactly the kind of distinction that's invisible from the DOM but
    // obvious from the control.
    await ui5(page).text('Laptops', { controlType: 'sap.m.StandardListItem' }).click();

    await expect
      .poll(async () => (await Ui5FlexibleColumnLayout.currentPages(page)).begin)
      .toContain('category');
    expect(await Ui5FlexibleColumnLayout.layout(page)).toBe('TwoColumnsMidExpanded');
  });

  test('a layout can be forced, for setting up a state directly', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    await Ui5FlexibleColumnLayout.setLayout(page, 'OneColumn');
    expect(await Ui5FlexibleColumnLayout.layout(page)).toBe('OneColumn');
    expect(await Ui5FlexibleColumnLayout.visibleColumnCount(page)).toBe(1);

    await Ui5FlexibleColumnLayout.setLayout(page, 'ThreeColumnsEndExpanded');
    expect(await Ui5FlexibleColumnLayout.visibleColumnCount(page)).toBe(3);
  });
});
