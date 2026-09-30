import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { idSelector } from './domSelectors';
import type { Ui5TreeItemInfo } from './types';

/**
 * Reading and expanding/collapsing `sap.m.Tree` - hierarchical data (org charts, category trees,
 * nested groupings) rendered as an indented, expandable list. See docs/tree.md.
 *
 * Two things make a tree harder to automate than a flat list: what's rendered right now is only
 * the *visible* slice (a collapsed node's descendants aren't in the DOM at all until it's
 * expanded - unlike a table's off-screen rows, they don't exist yet, not just scrolled away), and
 * "is this node expandable, and is it currently open" isn't visible text. `items()` reads the
 * tree's real, currently-rendered node list straight off the control (`level`/`expanded` come
 * from `sap.m.StandardTreeItem#getLevel()`/`getExpanded()`, verified against a real `sap.m.Tree`
 * SDK sample - not inferred from indentation or a CSS class); `expand()`/`collapse()` click each
 * node's own expand toggle, which SAPUI5 renders at a verified, predictable id
 * (`<itemId>-expander`) - the same real click a user makes, so it fires the control's own
 * `toggleOpenState` event.
 *
 * ```ts
 * const tree = ui5(page).controlType('sap.m.Tree');
 * const items = await Ui5Tree.items(page, tree);
 * expect(items.map((i) => i.title)).toEqual(['Node1', 'Node2']);
 *
 * await Ui5Tree.expand(page, tree, 'Node1');
 * expect(await Ui5Tree.items(page, tree)).toContainEqual(
 *   expect.objectContaining({ title: 'Node1-1', level: 1 }),
 * );
 * ```
 */
export class Ui5Tree {
  /** Every currently-rendered node, in the tree's own flat order (collapsed descendants simply
   * aren't in this list yet) - `{ id, title, level, expanded, leaf }`. `level` is 0-based. */
  static async items(target: Ui5Target, tree: Ui5Locator | Locator): Promise<Ui5TreeItemInfo[]> {
    const info = await Ui5Bridge.getTreeInfo(target, await resolveId(tree));
    return info.items;
  }

  /** Expands the node whose title matches `text` - clicks its own expand toggle
   * (`<itemId>-expander`), a real click so the control's own `toggleOpenState` event fires. A
   * no-op if the node is already expanded or is a leaf with nothing to expand. */
  static async expand(target: Ui5Target, tree: Ui5Locator | Locator, text: string): Promise<void> {
    await toggle(target, tree, text, true);
  }

  /** Collapses the node whose title matches `text` - see `expand()` above; a no-op if the node
   * is already collapsed. */
  static async collapse(
    target: Ui5Target,
    tree: Ui5Locator | Locator,
    text: string,
  ): Promise<void> {
    await toggle(target, tree, text, false);
  }

  /**
   * Expands every node down to `level` (0-based) in one call, via the control's own
   * `expandToLevel()`. The base `sap.m.Tree` has no single rendered control for this - only a
   * per-node toggle - so, unlike `expand()`/`collapse()`, this calls the control method directly
   * rather than clicking `level`'s worth of individual toggles.
   */
  static async expandToLevel(
    target: Ui5Target,
    tree: Ui5Locator | Locator,
    level: number,
  ): Promise<void> {
    const id = await resolveId(tree);
    const result = await Ui5Bridge.expandTreeToLevel(target, id, level);
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5Tree.expandToLevel: could not expand ${id} to level ${level} (${result.found ? result.error : 'not a sap.m.Tree'}).`,
      );
    }
  }

  /** Collapses every node back to the top level, via the control's own `collapseAll()` - same
   * reasoning as `expandToLevel()` above. */
  static async collapseAll(target: Ui5Target, tree: Ui5Locator | Locator): Promise<void> {
    const id = await resolveId(tree);
    const result = await Ui5Bridge.collapseTreeAll(target, id);
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5Tree.collapseAll: could not collapse ${id} (${result.found ? result.error : 'not a sap.m.Tree'}).`,
      );
    }
  }
}

async function toggle(
  target: Ui5Target,
  tree: Ui5Locator | Locator,
  text: string,
  wantExpanded: boolean,
): Promise<void> {
  const id = await resolveId(tree);
  const info = await Ui5Bridge.getTreeInfo(target, id);
  const match = info.items.find((item) => item.title === text);
  if (!match) {
    throw new Error(
      `[playwright-sapui5] Ui5Tree.${wantExpanded ? 'expand' : 'collapse'}: no rendered node titled "${text}". Currently rendered: ${JSON.stringify(info.items.map((i) => i.title))}`,
    );
  }
  if (match.leaf || match.expanded === wantExpanded) return;
  await target.locator(idSelector(`${match.id}-expander`)).click();
}

/** Accepts either a `Ui5Locator` or an already-resolved Playwright `Locator`, the same as every
 * other control-state helper in this framework - what's actually needed is the exact DOM id. */
async function resolveId(control: Ui5Locator | Locator): Promise<string> {
  const locator = control instanceof Ui5Locator ? await control.resolve() : control;
  return locator.first().evaluate((el) => el.id);
}
