import type { Locator, Page } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { idSelector, idsSelector } from './domSelectors';

/**
 * A higher-level API for `sap.m.Table` and `sap.m.List` - row access by index or content, cell
 * text (for `sap.m.Table`), and column headers - built on top of the same "scoped descendant
 * search" bridge functions (`findDescendantControlsByType`, `getAggregation`) that back a couple
 * of other advanced features too. See docs/ui5-table.md for full usage, the exact DOM structure
 * this relies on (verified against a real `sap.m.Table`), and its limits (notably: it does not
 * support `sap.ui.table.Table`, the separate "grid" table control with virtualized rows).
 */

/** Row control types tried, in order, when `Ui5Table.from()` isn't told which one to expect -
 * the first one that actually has any rendered rows wins. Covers `sap.m.Table` (`ColumnListItem`)
 * and the three item types `sap.m.List` commonly uses. */
const CANDIDATE_ROW_TYPES = [
  'sap.m.ColumnListItem',
  'sap.m.ObjectListItem',
  'sap.m.StandardListItem',
  'sap.m.CustomListItem',
];

async function detectRowType(page: Page, containerId: string): Promise<string> {
  for (const type of CANDIDATE_ROW_TYPES) {
    const matches = await Ui5Bridge.findDescendantControlsByType(page, containerId, type);
    if (matches.length > 0) return type;
  }
  // Nothing matched (an empty table, or a row type this list doesn't know about) - fall back to
  // the most common case rather than throwing here; `rowCount()` will simply report 0.
  return CANDIDATE_ROW_TYPES[0];
}

export class Ui5Table {
  private constructor(
    private readonly page: Page,
    private readonly containerId: string,
    private readonly rowType: string,
  ) {}

  /**
   * Wraps a `sap.m.Table` or `sap.m.List` located by `tableLocator`. Resolves `tableLocator`
   * once (with the same self-healing/auto-wait behavior as any other `Ui5Locator` resolution) to
   * find the container's exact DOM id, then - unless `options.rowControlType` says otherwise -
   * auto-detects what its rows are by trying each of `sap.m.ColumnListItem`, `sap.m.ObjectListItem`,
   * `sap.m.StandardListItem`, and `sap.m.CustomListItem` in turn.
   */
  static async from(
    tableLocator: Ui5Locator,
    options: { rowControlType?: string; timeout?: number } = {},
  ): Promise<Ui5Table> {
    const resolved = await tableLocator.resolve({ timeout: options.timeout });
    const page = resolved.page();
    const containerId = await resolved.first().evaluate((el) => el.id);
    const rowType = options.rowControlType ?? (await detectRowType(page, containerId));
    return new Ui5Table(page, containerId, rowType);
  }

  /** Every currently-rendered row's `{ id, type }` - the shared lookup every other method here
   * builds on. Note "currently rendered": a `growing`-enabled table only renders a subset of its
   * bound data, so this (and everything below) only sees what's actually on screen right now,
   * matching this framework's general "only what's real and visible" philosophy - see
   * docs/core-concepts.md. */
  private async rows() {
    return Ui5Bridge.findDescendantControlsByType(this.page, this.containerId, this.rowType);
  }

  /** How many rows are currently rendered. */
  async rowCount(): Promise<number> {
    return (await this.rows()).length;
  }

  /** The Nth currently-rendered row (0-based), as a plain Playwright `Locator`. Throws if
   * `index` is out of range - a clearer failure than Playwright's own "resolved to 0 elements"
   * for a `.nth()` call past the end. */
  async row(index: number): Promise<Locator> {
    const rows = await this.rows();
    if (index < 0 || index >= rows.length) {
      throw new Error(
        `[playwright-sapui5] Ui5Table row index ${index} is out of range (table has ${rows.length} rendered rows).`,
      );
    }
    return this.page.locator(idSelector(rows[index].id));
  }

  /**
   * The first currently-rendered row containing `text` anywhere within it, as a plain Playwright
   * `Locator`. Scopes the search to this table's own rows first (via the bridge), then narrows by
   * visible text with Playwright's own `.filter({ hasText })` - so a same-labeled row in some
   * other table/list on the page is never a false match.
   */
  async rowContaining(text: string): Promise<Locator> {
    const rows = await this.rows();
    const candidates = this.page.locator(idsSelector(rows.map((r) => r.id)));
    return candidates.filter({ hasText: text }).first();
  }

  /**
   * The rendered text of one cell - **`sap.m.Table` (`ColumnListItem` rows) only**. Relies on a
   * verified, stable SAPUI5 rendering convention: each cell of a `ColumnListItem` renders as a
   * `<td id="<rowId>-cell<N>">` wrapper around whatever control that column actually holds
   * (a `Text`, an `ObjectIdentifier`, an `ObjectNumber`, ...) - reading that wrapper's own
   * rendered text works regardless of which specific control type is inside it. This does *not*
   * apply to `sap.m.List` rows (`StandardListItem`/`ObjectListItem`/`CustomListItem`), which have
   * no equivalent per-cell DOM structure - there's no tabular "column" concept for a plain list.
   */
  async cellText(rowIndex: number, cellIndex: number): Promise<string> {
    const rows = await this.rows();
    if (rowIndex < 0 || rowIndex >= rows.length) {
      throw new Error(
        `[playwright-sapui5] Ui5Table row index ${rowIndex} is out of range (table has ${rows.length} rendered rows).`,
      );
    }
    const cell = this.page.locator(idSelector(`${rows[rowIndex].id}-cell${cellIndex}`));
    return cell.innerText();
  }

  /**
   * The text of every column header, in order - **`sap.m.Table` only** (reads the table's own
   * `columns` aggregation, which `sap.m.List` doesn't have). Each column's `header` aggregation
   * holds one control (commonly a plain `sap.m.Text` or `sap.m.Label`); this reads its visible
   * text the same way `toHaveUi5Text`/`Ui5Locator.text(...)` do.
   */
  async columnHeaders(): Promise<string[]> {
    const columns = await Ui5Bridge.getAggregation(this.page, this.containerId, 'columns');
    const headers: string[] = [];
    for (const column of columns) {
      const headerControls = await Ui5Bridge.getAggregation(this.page, column.id, 'header');
      if (headerControls.length === 0) {
        headers.push('');
        continue;
      }
      const text = await Ui5Bridge.getControlText(this.page, headerControls[0].id);
      headers.push(text.value ?? '');
    }
    return headers;
  }
}
