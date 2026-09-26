import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { waitForUi5 } from './waits';

/**
 * Reading and driving `sap.f.FlexibleColumnLayout` - the one/two/three-column shell behind most
 * modern Fiori list-detail-detail apps. See docs/flexible-column-layout.md.
 *
 * The reason this needs a helper: **all three columns exist in the DOM all the time**, sized by
 * CSS, whether or not they're showing anything. So "is the detail column open?" can't be answered
 * by looking for the column's element - it's always there. The honest answer lives in the
 * control's own `layout` property, which is a SAPUI5 enum (`'OneColumn'`,
 * `'TwoColumnsMidExpanded'`, `'ThreeColumnsEndExpanded'`, ...) describing the arrangement
 * exactly. That's what this class reads.
 *
 * ```ts
 * expect(await Ui5FlexibleColumnLayout.layout(page)).toBe('OneColumn');
 * await someMasterListItem.click();
 * expect(await Ui5FlexibleColumnLayout.layout(page)).toMatch(/TwoColumns/);
 * ```
 */
export class Ui5FlexibleColumnLayout {
  /** The current layout, as SAPUI5's own enum value - e.g. `'OneColumn'`,
   * `'TwoColumnsMidExpanded'`, `'ThreeColumnsEndExpanded'`. */
  static async layout(
    target: Ui5Target,
    flexibleColumnLayout?: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const info = await Ui5Bridge.getFlexibleColumnLayoutInfo(
      target,
      await resolveId(target, flexibleColumnLayout),
    );
    return info.layout;
  }

  /** How many columns the current layout actually shows (1, 2 or 3) - a friendlier form of
   * `layout()` for the common "did the detail column open?" assertion, derived from the enum
   * value's own naming rather than from anything about the DOM. */
  static async visibleColumnCount(
    target: Ui5Target,
    flexibleColumnLayout?: Ui5Locator | Locator,
  ): Promise<number> {
    const layout = (await this.layout(target, flexibleColumnLayout)) ?? '';
    if (layout.startsWith('Three')) return 3;
    if (layout.startsWith('Two')) return 2;
    return 1;
  }

  /** Which page is currently showing in each column, by control id - `undefined` for a column
   * that isn't displaying anything. */
  static async currentPages(
    target: Ui5Target,
    flexibleColumnLayout?: Ui5Locator | Locator,
  ): Promise<{ begin?: string; mid?: string; end?: string }> {
    const info = await Ui5Bridge.getFlexibleColumnLayoutInfo(
      target,
      await resolveId(target, flexibleColumnLayout),
    );
    return { begin: info.beginPage, mid: info.midPage, end: info.endPage };
  }

  /**
   * Forces a specific layout - the escape hatch for putting the shell into a given arrangement
   * without clicking through whatever navigation normally produces it (useful for going straight
   * to a three-column state, or for checking responsive behaviour). Waits for the app to settle
   * afterwards, since a layout change re-renders columns.
   *
   * Prefer driving the app's own navigation where you can: that exercises the routing the users
   * actually hit. This is for setting up a state, not for replacing the interaction under test.
   */
  static async setLayout(
    target: Ui5Target,
    layout: string,
    flexibleColumnLayout?: Ui5Locator | Locator,
    options: { timeout?: number } = {},
  ): Promise<void> {
    const id = await resolveId(target, flexibleColumnLayout);
    const result = await Ui5Bridge.setFlexibleColumnLayout(target, id, layout);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5FlexibleColumnLayout.setLayout: no sap.f.FlexibleColumnLayout found with id "${id}".`,
      );
    }
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5FlexibleColumnLayout.setLayout failed: ${result.error ?? 'unknown error'}`,
      );
    }
    await waitForUi5(target, { timeout: options.timeout }).catch(() => {
      /* best-effort, as everywhere else */
    });
  }
}

/** An app almost always has exactly one FlexibleColumnLayout, so the locator is optional - it
 * defaults to finding the single one on the page. Pass one explicitly only for the unusual app
 * that nests more than one. */
async function resolveId(
  target: Ui5Target,
  flexibleColumnLayout?: Ui5Locator | Locator,
): Promise<string> {
  if (!flexibleColumnLayout) {
    const found = await Ui5Bridge.findControlsByType(target, 'sap.f.FlexibleColumnLayout');
    if (found.length === 0) {
      throw new Error(
        '[playwright-sapui5] Ui5FlexibleColumnLayout: no sap.f.FlexibleColumnLayout on this page.',
      );
    }
    return found[0].id;
  }
  const locator =
    flexibleColumnLayout instanceof Ui5Locator
      ? await flexibleColumnLayout.resolve()
      : flexibleColumnLayout;
  return locator.first().evaluate((el) => el.id);
}
