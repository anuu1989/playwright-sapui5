import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import type { Ui5Locator } from './Ui5Locator';
import { idSelector, idsSelector } from './domSelectors';
import type { Ui5GridTableInfo } from './types';

/**
 * A higher-level API for `sap.ui.table.Table` - the separate "grid" table control (also the base
 * for `sap.ui.table.TreeTable`), distinct from `sap.m.Table`/`sap.m.List` (see [`Ui5Table`](Ui5Table.ts)
 * for those). See docs/ui5-grid-table.md for full usage and the exact behavior this relies on,
 * verified against real `sap.ui.table.Table` instances (a small one inside a `ValueHelpDialog`,
 * and a 123-row one from the SAPUI5 SDK's own sample).
 *
 * What makes this control genuinely harder to automate than `sap.m.Table` is that it
 * **virtualizes** its rows: rather than rendering one DOM row per data row, it keeps a small,
 * fixed pool of `<tr>` elements (sized by its own `visibleRowCount` setting) and re-binds them to
 * different data rows as the table scrolls. `Ui5Table`'s approach - search the DOM for every
 * currently-rendered row of a given control type - doesn't translate here: the *ids* of the
 * pooled row elements never change, but *which data row* each one currently displays does, and a
 * table with (for example) 500 rows of data might only ever have 10 of those rows' worth of DOM
 * elements in existence at once. `row()`/`cellText()` below only ever see whatever's in that pool
 * right now; `scrollToRow()` is how you bring a specific data row into it.
 */
export class Ui5GridTable {
  private constructor(
    private readonly target: Ui5Target,
    private readonly containerId: string,
  ) {}

  /**
   * Wraps a `sap.ui.table.Table` located by `tableLocator`. Resolves `tableLocator` once (with
   * the same self-healing/auto-wait behavior as any other `Ui5Locator` resolution) to find the
   * container's exact DOM id.
   */
  static async from(
    tableLocator: Ui5Locator,
    options: { timeout?: number } = {},
  ): Promise<Ui5GridTable> {
    const resolved = await tableLocator.resolve({ timeout: options.timeout });
    const target = resolved.page();
    const containerId = await resolved.first().evaluate((el) => el.id);
    return new Ui5GridTable(target, containerId);
  }

  private async info(): Promise<Ui5GridTableInfo> {
    return Ui5Bridge.getGridTableInfo(this.target, this.containerId);
  }

  /** The **true** total row count, read from the table's own data binding - not however many
   * rows happen to be rendered right now. `undefined` if the table hasn't bound any data yet. */
  async rowCount(): Promise<number | undefined> {
    return (await this.info()).rowCount;
  }

  /** The data index of the first row currently rendered (what `scrollToRow()` last set, or `0`
   * before any scrolling). Mostly useful for understanding why `.row(index)` did or didn't find
   * something, without having to reason about the row pool yourself. */
  async firstVisibleRow(): Promise<number> {
    return (await this.info()).firstVisibleRow ?? 0;
  }

  /** How many rows are *currently rendered with real data* right now (between `0` and the
   * table's row pool size) - i.e. how many consecutive indices starting at `firstVisibleRow()`
   * you can call `.row()`/`.cellText()` on without calling `scrollToRow()` first. */
  async renderedRowCount(): Promise<number> {
    return (await this.info()).renderedRows.length;
  }

  /**
   * Scrolls the table so that data row `rowIndex` becomes one of its currently rendered rows, via
   * the control's own `setFirstVisibleRow(rowIndex)` method - the same API SAPUI5 itself uses for
   * programmatic scrolling. Call this before `.row()`/`.cellText()` for any index outside the
   * table's default rendered window (see `renderedRowCount()`/`firstVisibleRow()` above).
   */
  async scrollToRow(rowIndex: number): Promise<void> {
    const result = await Ui5Bridge.scrollGridTableToRow(this.target, this.containerId, rowIndex);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5GridTable.scrollToRow: control ${this.containerId} is not a sap.ui.table.Table (or no longer exists).`,
      );
    }
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5GridTable.scrollToRow failed: ${result.error ?? 'unknown error'}`,
      );
    }
  }

  /** The exact DOM id of the row currently showing data index `index` - shared by `.row()` and
   * `.cellText()`. Throws a clear, actionable error (naming the currently-rendered range and
   * suggesting `scrollToRow()`) rather than Playwright's generic "resolved to 0 elements" when
   * `index` isn't in the table's current row pool. */
  private async renderedRowId(index: number): Promise<string> {
    const info = await this.info();
    const firstVisibleRow = info.firstVisibleRow ?? 0;
    const windowIndex = index - firstVisibleRow;
    if (windowIndex < 0 || windowIndex >= info.renderedRows.length) {
      const lastRendered = firstVisibleRow + info.renderedRows.length - 1;
      throw new Error(
        info.renderedRows.length > 0
          ? `[playwright-sapui5] Ui5GridTable row ${index} is not currently rendered (rows ${firstVisibleRow}-${lastRendered} are, out of ${info.rowCount ?? 'an unknown number of'} total). Call .scrollToRow(${index}) first.`
          : `[playwright-sapui5] Ui5GridTable row ${index} is not currently rendered (the table has no rendered rows right now). Call .scrollToRow(${index}) first.`,
      );
    }
    return info.renderedRows[windowIndex].id;
  }

  /**
   * The row at data index `index`, as a plain Playwright `Locator` - only works if that row is
   * currently rendered (see `renderedRowCount()`/`firstVisibleRow()`, or just call
   * `scrollToRow(index)` first if unsure).
   */
  async row(index: number): Promise<Locator> {
    const id = await this.renderedRowId(index);
    return this.target.locator(idSelector(id));
  }

  /**
   * The rendered text of one cell, by data row index and 0-based column index - relies on the
   * same verified rendering convention `Ui5Table.cellText()` uses for `sap.m.Table`, adapted for
   * this control: each rendered row's Nth cell renders as `<td id="<rowId>-colN">`. Only works if
   * `rowIndex` is currently rendered - see `.row()` above.
   */
  async cellText(rowIndex: number, columnIndex: number): Promise<string> {
    const rowId = await this.renderedRowId(rowIndex);
    const cell = this.target.locator(idSelector(`${rowId}-col${columnIndex}`));
    return cell.innerText();
  }

  /**
   * The first *currently rendered* row containing `text` anywhere within it, as a plain
   * Playwright `Locator` - scoped to this table's own rendered rows first (via the bridge), then
   * narrowed by visible text with Playwright's own `.filter({ hasText })`, the same pattern
   * `Ui5Table.rowContaining` uses. Only searches what's currently rendered - `scrollToRow()`
   * through the data first if the row you're looking for might be further down.
   */
  async rowContaining(text: string): Promise<Locator> {
    const info = await this.info();
    const candidates = this.target.locator(idsSelector(info.renderedRows.map((r) => r.id)));
    return candidates.filter({ hasText: text }).first();
  }

  /**
   * The text of every column header, in order. Reads the table's own `columns` aggregation (each
   * a `sap.ui.table.Column`) and each column's `label` aggregation (a single control, usually a
   * plain `sap.m.Label`) - note this is `label` (singular), not the `header` aggregation
   * `sap.m.Table`'s columns use, since `sap.ui.table.Column` is a different control with its own
   * aggregation names.
   */
  async columnHeaders(): Promise<string[]> {
    const columns = await Ui5Bridge.getAggregation(this.target, this.containerId, 'columns');
    const headers: string[] = [];
    for (const column of columns) {
      const labelControls = await Ui5Bridge.getAggregation(this.target, column.id, 'label');
      if (labelControls.length === 0) {
        headers.push('');
        continue;
      }
      const text = await Ui5Bridge.getControlText(this.target, labelControls[0].id);
      headers.push(text.value ?? '');
    }
    return headers;
  }
}
