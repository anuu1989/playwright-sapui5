import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';

/**
 * Reading a `sap.ui.mdc.Table`'s true state - the "metadata-driven controls" (MDC) table that
 * **Fiori Elements for OData V4** (the flexible programming model, `sap.fe`) renders in a List
 * Report, in place of `sap.ui.comp.smarttable.SmartTable` (see
 * [docs/smart-controls.md](../docs/smart-controls.md) for that OData V2 equivalent). See
 * docs/mdc-table.md.
 *
 * ```ts
 * const table = ui5(page).controlType('sap.ui.mdc.Table');
 * expect(await Ui5MdcTable.rowCount(page, table)).toBeGreaterThan(0);
 * expect(await Ui5MdcTable.columnHeaders(page, table)).toContain('Status');
 * ```
 *
 * **Deliberately narrow scope.** This reads `rowCount()` and `columnHeaders()` only - both from
 * the table's own binding/column metadata, verified against a real, live `sap.fe` app. Row/cell
 * **text** access is not provided: `sap.ui.mdc.Table` wraps an inner rendering table, but unlike
 * `Ui5SmartTable`'s inner table (reachable via a documented aggregation), this one's inner table
 * wasn't reliably reachable in testing - a plausible-looking `<id>-innerTable` control exists but
 * doesn't hold the actually-rendered rows, and shipping a locator that might silently return zero
 * rows would be worse than not shipping one. To read a specific cell's text today, fall back to a
 * plain `ui5()` locator scoped under the table's id.
 *
 * **Filtering a `sap.fe` list report** doesn't go through this class at all - the bulk
 * `setFilterConditions()`/`triggerSearch()` API on the filter bar control did **not** reliably
 * propagate to the table in testing (the row count stayed unchanged even with a real, valid
 * condition). What did work, verified end to end: filling each filter field's real rendered
 * `<input>` directly (`ui5(page).id('...FilterField::TravelID').resolve()` then `.locator('input')`,
 * or simpler, whatever field-specific locator finds it) and clicking the real "Go" button - the
 * same way you'd drive any other input. See docs/mdc-table.md for a full example.
 */
export class Ui5MdcTable {
  /** The table's true row count, from its own data binding - not how many rows happen to be
   * rendered right now. */
  static async rowCount(
    target: Ui5Target,
    table: Ui5Locator | Locator,
  ): Promise<number | undefined> {
    const id = await resolveId(table);
    const info = await Ui5Bridge.getMdcTableInfo(target, id);
    return info.rowCount;
  }

  /** Column headers, in column order, as SAPUI5 rendered them. */
  static async columnHeaders(target: Ui5Target, table: Ui5Locator | Locator): Promise<string[]> {
    const id = await resolveId(table);
    const info = await Ui5Bridge.getMdcTableInfo(target, id);
    return info.columnHeaders;
  }
}

async function resolveId(table: Ui5Locator | Locator): Promise<string> {
  const locator = table instanceof Ui5Locator ? await table.resolve() : table;
  return locator.first().evaluate((el) => el.id);
}
