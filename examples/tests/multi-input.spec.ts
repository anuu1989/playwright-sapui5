import { test, expect } from '../../src';
import { ui5, Ui5MultiInput } from '../../src';

// The SAPUI5 SDK's own official sample for sap.m.MultiInput.
const sample = (id: string) =>
  `https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com&sap-ui-xx-sample-id=${id}`;

/**
 * Demonstrates `Ui5MultiInput` - adding tokens via the real suggestion flow and reading their
 * `key` (real bound data with no DOM representation at all) and removing them again. See
 * docs/multi-input.md.
 */
test.describe('Ui5MultiInput', () => {
  test('adds a token via suggestions, reads its key, then removes it', async ({ page }) => {
    await page.goto(sample('sap.m.sample.MultiInput'));

    // This sample renders three sap.m.MultiInput fields side by side (only the first has
    // suggestion data) - scope by its own local id rather than `controlType()`, the same
    // "disambiguate by known id" approach docs/icon-tab-bar.md's gotcha section uses for a page
    // that happens to render more than one control of the same type.
    const field = ui5(page).id('multiInput');

    expect(await Ui5MultiInput.tokens(page, field)).toEqual([]);

    await Ui5MultiInput.addByText(page, field, 'Astro Laptop 1516');

    const tokens = await Ui5MultiInput.tokens(page, field);
    expect(tokens).toHaveLength(1);
    // The key is real bound data ('HT-1251') - never rendered anywhere in the DOM, only readable
    // straight off the sap.m.Token control itself.
    expect(tokens[0]).toMatchObject({ key: 'HT-1251', text: 'Astro Laptop 1516' });

    await Ui5MultiInput.removeByText(page, field, 'Astro Laptop 1516');
    expect(await Ui5MultiInput.tokens(page, field)).toEqual([]);
  });
});
