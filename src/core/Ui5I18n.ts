import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';

/**
 * Reads text out of the app's **own** i18n `ResourceBundle` - the exact string the app itself
 * renders, in whatever language it happens to be running in. See docs/i18n.md.
 *
 * This exists to kill a whole category of quietly-broken tests. A SAPUI5 app is translated; the
 * literal `'Add to Cart'` in a test is one specific language's rendering of the key
 * `addToCartButtonText`, and it silently stops matching the moment the suite runs against a
 * German system, a translation lands, or someone fixes a typo in the English bundle. Looking the
 * key up instead means the test asserts on *the same source of truth the app renders from*, so it
 * keeps passing in every locale and keeps failing for the one reason it should: the app showing
 * genuinely wrong text.
 *
 * ```ts
 * const expected = await Ui5I18n.getText(page, 'addToCartButtonText');
 * await expect(ui5(page).text(expected, { controlType: 'sap.m.Button' })).toBeVisible();
 * ```
 */
export class Ui5I18n {
  /**
   * The translated text for `key`, or throws if no resource bundle on the page has it - a
   * deliberately loud failure, because a missing key is nearly always a typo or a bundle that
   * didn't load, and silently returning the key itself (which is what SAPUI5's own
   * `getText()` does) would turn that into a confusing assertion failure much further downstream.
   *
   * `options.args` fills placeholders (`{0}`, `{1}`, ...) exactly as SAPUI5 does;
   * `options.modelName` picks a specific i18n model when an app has more than one (default:
   * `'i18n'`, then any model that looks like a resource bundle).
   */
  static async getText(
    target: Ui5Target,
    key: string,
    options: { args?: (string | number)[]; modelName?: string } = {},
  ): Promise<string> {
    const result = await Ui5Bridge.getI18nText(target, key, options.args, options.modelName);
    if (!result.found || result.value === undefined) {
      throw new Error(
        `[playwright-sapui5] Ui5I18n.getText: no i18n text found for key "${key}". Check the key's spelling, or pass { modelName } if this app's resource bundle isn't on the usual "i18n" model - Ui5Model.listModels() shows which models exist.`,
      );
    }
    return result.value;
  }

  /** Whether `key` exists in any of the app's resource bundles - the non-throwing counterpart to
   * `getText()`, for when a key's presence is itself what you're asserting on (e.g. a feature
   * that's only translated in some deployments). */
  static async hasText(
    target: Ui5Target,
    key: string,
    options: { modelName?: string } = {},
  ): Promise<boolean> {
    const result = await Ui5Bridge.getI18nText(target, key, undefined, options.modelName);
    return result.found;
  }
}
