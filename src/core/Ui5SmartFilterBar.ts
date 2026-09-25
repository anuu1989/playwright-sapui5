import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import type { Ui5Locator } from './Ui5Locator';
import { waitForUi5 } from './waits';

/**
 * A helper for `sap.ui.comp.smartfilterbar.SmartFilterBar` (Fiori Elements' generated filter
 * bar): set filter values and trigger a search without having to find and interact with each
 * individual, dynamically-generated filter field. See docs/smart-controls.md.
 *
 * A SmartFilterBar's fields aren't something you write once and keep stable - they're generated
 * at runtime from OData metadata/annotations, one field per filterable property, and the actual
 * widget behind each one (`sap.m.Input`, `MultiInput`, `DatePicker`, `ComboBox`, `Switch`, even a
 * paired "from/to" `DateRangeType`) depends on that property's type and annotations. A test that
 * tried to click into each field individually would have to know, and keep up to date with,
 * exactly which widget every property currently uses. This helper sidesteps that entirely by
 * using the SmartFilterBar's own `setFilterData`/`getFilterData`/`search` methods - the same API
 * SAPUI5 itself uses internally - so filling filters and running a search stays two or three
 * calls regardless of what the underlying fields happen to be.
 */
export class Ui5SmartFilterBar {
  private constructor(
    private readonly target: Ui5Target,
    private readonly id: string,
  ) {}

  /**
   * Wraps a SmartFilterBar located by `filterBarLocator`. Resolves it once (with the same
   * self-healing/auto-wait behavior as any other `Ui5Locator` resolution) to find its exact DOM
   * id - typically built with `ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar')`.
   */
  static async from(
    filterBarLocator: Ui5Locator,
    options: { timeout?: number } = {},
  ): Promise<Ui5SmartFilterBar> {
    const resolved = await filterBarLocator.resolve({ timeout: options.timeout });
    const target = resolved.page();
    const id = await resolved.first().evaluate((el) => el.id);
    return new Ui5SmartFilterBar(target, id);
  }

  /**
   * Sets several filter values at once, via the control's own `setFilterData(data)` - `data`'s
   * keys are OData property names (the same names `getFilterData()` returns), not field labels or
   * control ids. Throws if this isn't actually a SmartFilterBar, or if SAPUI5's own
   * `setFilterData` call throws (e.g. a value that doesn't match the field's expected type).
   */
  async setFilterData(data: Record<string, unknown>): Promise<void> {
    const result = await Ui5Bridge.setSmartFilterBarData(this.target, this.id, data);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5SmartFilterBar.setFilterData: control ${this.id} is not a SmartFilterBar (or no longer exists).`,
      );
    }
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5SmartFilterBar.setFilterData failed: ${result.error ?? 'unknown error'}`,
      );
    }
  }

  /** Reads the current filter values, in the same `{ propertyName: value }` shape `setFilterData`
   * accepts - useful for asserting on filter state, or round-tripping a value you just set. */
  async getFilterData(): Promise<Record<string, unknown>> {
    const result = await Ui5Bridge.getSmartFilterBarData(this.target, this.id);
    return result.value ?? {};
  }

  /**
   * Triggers a search directly via the control's own `search()` method - equivalent to clicking
   * its "Go" button, without needing to find that button (its visible label is localized, and its
   * id is auto-generated like everything else on this control). Then waits for the app to settle
   * (`waitForUi5` - no busy indicator, no pending requests, stable control tree) the same way
   * every other action in this framework does, since a search always fires an async OData request
   * behind the scenes - without this, a follow-up assertion could easily run before results (or an
   * error, or an updated row count) have actually arrived. That wait is best-effort: it's swallowed
   * on timeout rather than thrown, matching `Ui5Locator`'s own actions, so a search against a
   * particularly slow backend doesn't fail the whole call over what's ultimately just a
   * courtesy wait.
   */
  async search(options: { timeout?: number } = {}): Promise<void> {
    const result = await Ui5Bridge.triggerSmartFilterBarSearch(this.target, this.id);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5SmartFilterBar.search: control ${this.id} is not a SmartFilterBar (or no longer exists).`,
      );
    }
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5SmartFilterBar.search failed: ${result.error ?? 'unknown error'}`,
      );
    }
    await waitForUi5(this.target, { timeout: options.timeout }).catch(() => {
      /* best-effort: don't fail search() just because busy-state never settled */
    });
  }
}
