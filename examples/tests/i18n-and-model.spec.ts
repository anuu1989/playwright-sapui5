import { test, expect } from '../../src';
import { ui5, Ui5I18n, Ui5Model } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates asserting against what the app is actually *made of* - its own translated texts
 * (`Ui5I18n`) and its own model data (`Ui5Model`) - instead of against rendered display text.
 * See docs/i18n.md and docs/model-data.md.
 */
test.describe('App texts and model data', () => {
  test('i18n: assert using the app own translated text, not a hardcoded string', async ({
    page,
  }) => {
    const cart = new CartPage(page);
    await cart.open();

    // The literal 'Product Catalog' would be one specific language's rendering of this key - it
    // silently stops matching the day the suite runs against a translated system. Looking the key
    // up reads the same source of truth the app itself renders from.
    const homeTitle = await Ui5I18n.getText(page, 'homeTitle');
    expect(homeTitle).toBe('Product Catalog');
    // `controlType` scopes this to the heading itself - the containing `sap.m.Page` carries the
    // same string as its own `title` property, so an unscoped text search matches both.
    await expect(
      await ui5(page).text(homeTitle, { controlType: 'sap.m.Title' }).resolve(),
    ).toBeVisible();

    // Placeholder substitution works exactly as it does in the app: this bundle's `priceKey` is
    // "Price ({0} - {1} EUR)".
    expect(await Ui5I18n.getText(page, 'priceKey', { args: [0, 100] })).toBe('Price (0 - 100 EUR)');

    // `hasText` is the non-throwing counterpart, for when a key's existence is itself in question.
    expect(await Ui5I18n.hasText(page, 'homeTitle')).toBe(true);
    expect(await Ui5I18n.hasText(page, 'noSuchKeyAnywhere')).toBe(false);

    // A missing key throws loudly rather than silently returning the key back, which is what
    // SAPUI5's own getText() does - and which would otherwise surface as a baffling assertion
    // failure much further downstream.
    await expect(Ui5I18n.getText(page, 'noSuchKeyAnywhere')).rejects.toThrow(/no i18n text found/);
  });

  test('model: read the full entity behind a row, including fields the UI never renders', async ({
    page,
  }) => {
    const cart = new CartPage(page);
    await cart.open();

    // `listModels()` answers "what models does this app even have?" - names are an app-internal
    // detail nothing in the UI exposes. '' is the default, unnamed model.
    expect(await Ui5Model.listModels(page)).toEqual(
      expect.arrayContaining(['', 'i18n', 'cartProducts']),
    );

    // The whole OData entity behind the first category row - not the one or two fields the row
    // happens to display, and not their formatted, localized, possibly-truncated rendering.
    const firstCategory = ui5(page).controlType('sap.m.StandardListItem');
    const { hasContext, path, data } = await Ui5Model.getBindingContextData(page, firstCategory);

    expect(hasContext).toBe(true);
    expect(path).toMatch(/^\/ProductCategories/);
    // `NumberOfProducts` is a plain number here. The same value read off the screen would be a
    // string, formatted for the current locale, and only available if the row rendered it at all.
    expect(data).toMatchObject({
      CategoryName: expect.any(String),
      NumberOfProducts: expect.any(Number),
    });

    // Anything reachable by binding path can be read directly too - here, re-reading the same
    // field via the path the binding context reported.
    const categoryName = await Ui5Model.getProperty(page, `${path}/CategoryName`);
    expect(categoryName).toBe((data as { CategoryName: string }).CategoryName);
  });
});
