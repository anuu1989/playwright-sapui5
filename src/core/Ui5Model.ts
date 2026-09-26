import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';

/**
 * Reads the app's **data** - what its models actually hold - rather than what's rendered on
 * screen. See docs/model-data.md.
 *
 * Rendered text is a lossy, formatted, localized *projection* of the data underneath it: a price
 * of `449.99` renders as `"449.99 USD"` or `"449,99 USD"` depending on locale, a date renders in
 * whatever pattern the app configured, a long description renders truncated with an ellipsis, and
 * a field the app simply doesn't display renders not at all. Asserting on the projection means
 * writing tests that break on formatting changes and can't see anything the UI chose to hide.
 * These helpers read the source instead.
 *
 * ```ts
 * // The whole entity behind one table row - every field, unformatted
 * const { data } = await Ui5Model.getBindingContextData(page, await table.row(0));
 * expect(data).toMatchObject({ Category: 'Notebooks', Price: '449.99' });
 * ```
 */
export class Ui5Model {
  /**
   * A value from a model, by binding path (e.g. `/Products/0/Name`). `options.modelName` selects a
   * named model (default: the app's unnamed/default model); `options.control` resolves the model
   * relative to one control instead, which matters when a view or control sets its own model that
   * the component doesn't have.
   *
   * Returns `undefined` both for a path that holds nothing and for a model that doesn't exist -
   * use `listModels()` to check the latter if a lookup surprises you.
   */
  static async getProperty(
    target: Ui5Target,
    path: string,
    options: { modelName?: string; control?: Ui5Locator | Locator } = {},
  ): Promise<unknown> {
    const controlId = options.control ? await resolveControlId(options.control) : undefined;
    const result = await Ui5Bridge.getModelProperty(target, path, options.modelName, controlId);
    return result.value;
  }

  /**
   * The full data object a control is currently bound to - for a table row, the entire entity
   * behind it, including fields the row doesn't render. This is the single most useful thing here:
   * it turns "assert on the text in the third column" into "assert on the record this row *is*".
   *
   * `hasContext` is `false` for a control that exists but isn't bound to anything (a plain
   * container, or a row whose data hasn't arrived yet) - distinct from the control not existing at
   * all, which throws.
   */
  static async getBindingContextData(
    target: Ui5Target,
    control: Ui5Locator | Locator,
    options: { modelName?: string } = {},
  ): Promise<{ hasContext: boolean; path: string | undefined; data: unknown }> {
    const controlId = await resolveControlId(control);
    const result = await Ui5Bridge.getBindingContextData(target, controlId, options.modelName);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5Model.getBindingContextData: no control found with id "${controlId}".`,
      );
    }
    return { hasContext: result.hasContext, path: result.path, data: result.data };
  }

  /** Every model name the app's components have set, with `''` standing in for the default,
   * unnamed model. Purely a debugging aid - model names are an app-internal detail nothing in the
   * UI exposes, so this answers "what can I even pass as `modelName`?". */
  static async listModels(target: Ui5Target): Promise<string[]> {
    return Ui5Bridge.listModelNames(target);
  }
}

/** Both a `Ui5Locator` and an already-resolved Playwright `Locator` are accepted anywhere a
 * control is asked for here - the same convenience the custom matchers offer (see
 * `src/core/matchers.ts`). Either way what's actually needed is the control's exact DOM id, which
 * is what the bridge looks it up by. */
async function resolveControlId(control: Ui5Locator | Locator): Promise<string> {
  const locator = control instanceof Ui5Locator ? await control.resolve() : control;
  return locator.first().evaluate((el) => el.id);
}
