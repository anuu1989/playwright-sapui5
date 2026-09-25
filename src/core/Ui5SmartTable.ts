import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';

/**
 * A helper for `sap.ui.comp.smarttable.SmartTable` (Fiori Elements' generated result table),
 * usually paired with a [`Ui5SmartFilterBar`](Ui5SmartFilterBar.ts). See docs/smart-controls.md.
 *
 * What makes a SmartTable specifically awkward to automate is that it decides, at runtime, which
 * concrete table control to actually build - a plain `sap.m.Table` or the separate "grid" control
 * `sap.ui.table.Table` - based on its configuration and the OData metadata it's bound to. A test
 * can't assume which one it'll get, and `sap.ui.table.Table` in particular only ever renders a
 * small virtualized "window" of its bound rows in the DOM, so counting rendered DOM rows there -
 * the way [`Ui5Table`](Ui5Table.ts) does for a plain `sap.m.Table` - would badly undercount a
 * real result set. `rowCount()` below sidesteps that by reading the inner table's own data
 * binding length instead of anything DOM-based, so it's correct either way.
 */
export class Ui5SmartTable {
  private constructor(
    private readonly target: Ui5Target,
    private readonly id: string,
  ) {}

  /**
   * Wraps a SmartTable located by `smartTableLocator`. Resolves it once (with the same
   * self-healing/auto-wait behavior as any other `Ui5Locator` resolution) to find its exact DOM
   * id - typically built with `ui5(page).controlType('sap.ui.comp.smarttable.SmartTable')`.
   */
  static async from(
    smartTableLocator: Ui5Locator,
    options: { timeout?: number } = {},
  ): Promise<Ui5SmartTable> {
    const resolved = await smartTableLocator.resolve({ timeout: options.timeout });
    const target = resolved.page();
    const id = await resolved.first().evaluate((el) => el.id);
    return new Ui5SmartTable(target, id);
  }

  /**
   * The true row count of the current result set, read from the inner table's own data binding
   * (`getBinding('rows')` for a grid table, `getBinding('items')` for a response table) - not
   * however many rows happen to be rendered in the DOM right now. `undefined` if the SmartTable
   * hasn't built its inner table yet, or that table's binding hasn't loaded data yet (e.g. before
   * the first search) - call this after `Ui5SmartFilterBar.search()` or your own equivalent
   * trigger, not immediately after navigation.
   */
  async rowCount(): Promise<number | undefined> {
    const info = await Ui5Bridge.getSmartTableInfo(this.target, this.id);
    return info.rowCount;
  }

  /**
   * Which concrete table control this SmartTable built - `'sap.m.Table'` or `'sap.ui.table.Table'`
   * are the two SAPUI5 itself chooses between - or `null` if it hasn't built one yet. Useful to
   * decide how to interact with the result rows further: a `'sap.m.Table'` result can be wrapped
   * with `Ui5Table.from(smartTable.innerTableLocator())` for row/cell access.
   */
  async innerTableType(): Promise<string | null> {
    const info = await Ui5Bridge.getSmartTableInfo(this.target, this.id);
    return info.innerTable?.type ?? null;
  }

  /**
   * A `Ui5Locator` for the inner table's root - the escape hatch for anything this class doesn't
   * cover itself. Hand it straight to `Ui5Table.from(...)` when `innerTableType()` is
   * `'sap.m.Table'` for row/cell/header access, or call `.resolve()` on it yourself for a plain
   * Playwright `Locator`. Throws if the SmartTable hasn't built an inner table yet.
   */
  async innerTableLocator(): Promise<Ui5Locator> {
    const info = await Ui5Bridge.getSmartTableInfo(this.target, this.id);
    if (!info.innerTable) {
      throw new Error(
        `[playwright-sapui5] Ui5SmartTable ${this.id} has no inner table yet - has a search run?`,
      );
    }
    return Ui5Locator.id(this.target, info.innerTable.id, { exact: true });
  }
}
