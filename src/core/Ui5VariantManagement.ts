import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { waitForUi5 } from './waits';
import type { Ui5Variant } from './types';

/**
 * Reading and switching **variants** - the saved filter/column/sort configurations that sit at the
 * top of virtually every Fiori list report ("Standard", "My Open Items", ...). See
 * docs/variant-management.md.
 *
 * Two things make this worth wrapping. First, a variant switch isn't a cosmetic selection: it
 * re-applies a whole set of filters, columns and sort orders, so a test that just clicks the name
 * in the dropdown and carries on is racing an app-wide re-bind. Second, SAPUI5 has **two**
 * controls for this, stacked on top of each other, exposing the same concept under different
 * method names - `sap.ui.comp.smartvariants.SmartVariantManagement`
 * (`getCurrentVariantKey`/`getVariantItems`) and the newer `sap.m.VariantManagement` it wraps
 * (`getSelectedKey`/`getItems`). This class reads whichever one you hand it, and activates
 * variants through `activateVariant()` so the app's own apply logic and events run in full.
 *
 * ```ts
 * const vm = ui5(page).controlType('sap.ui.comp.smartvariants.SmartVariantManagement');
 * await Ui5VariantManagement.selectByName(page, vm, 'My Open Items');
 * ```
 */
export class Ui5VariantManagement {
  /** Every saved variant, as `{ key, text }` - `key` being what the app activates it by, `text`
   * the name shown in the dropdown. */
  static async variants(
    target: Ui5Target,
    variantManagement: Ui5Locator | Locator,
  ): Promise<Ui5Variant[]> {
    const info = await Ui5Bridge.getVariantInfo(target, await resolveControlId(variantManagement));
    return info.variants;
  }

  /** The key of the currently active variant (`'*standard*'` for the built-in default in a Fiori
   * Elements app). */
  static async currentKey(
    target: Ui5Target,
    variantManagement: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const info = await Ui5Bridge.getVariantInfo(target, await resolveControlId(variantManagement));
    return info.currentKey;
  }

  /** The display name of the currently active variant, resolved from its key. */
  static async currentName(
    target: Ui5Target,
    variantManagement: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const info = await Ui5Bridge.getVariantInfo(target, await resolveControlId(variantManagement));
    return info.variants.find((variant) => variant.key === info.currentKey)?.text;
  }

  /**
   * Activates the variant with this key, then waits for the app to settle - because applying a
   * variant re-applies its filters and columns, which usually means a fresh backend round trip.
   * Without that wait, the next assertion runs against the *previous* variant's data.
   */
  static async selectByKey(
    target: Ui5Target,
    variantManagement: Ui5Locator | Locator,
    key: string,
    options: { timeout?: number } = {},
  ): Promise<void> {
    const id = await resolveControlId(variantManagement);
    const result = await Ui5Bridge.selectVariant(target, id, key);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5VariantManagement.selectByKey: no control found with id "${id}".`,
      );
    }
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5VariantManagement.selectByKey failed: ${result.error ?? 'unknown error'}`,
      );
    }
    await waitForUi5(target, { timeout: options.timeout }).catch(() => {
      /* best-effort, same as every other action in this framework */
    });
  }

  /** Activates a variant by its display name - the label a user would pick from the dropdown.
   * Resolves the name to its key first, so it works regardless of which of the two variant
   * controls the app uses. */
  static async selectByName(
    target: Ui5Target,
    variantManagement: Ui5Locator | Locator,
    name: string,
    options: { timeout?: number } = {},
  ): Promise<void> {
    const id = await resolveControlId(variantManagement);
    const info = await Ui5Bridge.getVariantInfo(target, id);
    const match = info.variants.find((variant) => variant.text === name);
    if (!match || match.key === undefined) {
      throw new Error(
        `[playwright-sapui5] Ui5VariantManagement.selectByName: no variant named "${name}". Available: ${JSON.stringify(info.variants.map((variant) => variant.text))}`,
      );
    }
    await this.selectByKey(target, variantManagement, match.key, options);
  }
}

async function resolveControlId(control: Ui5Locator | Locator): Promise<string> {
  const locator = control instanceof Ui5Locator ? await control.resolve() : control;
  return locator.first().evaluate((el) => el.id);
}
