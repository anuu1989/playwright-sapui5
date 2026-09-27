import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { idSelector } from './domSelectors';
import { Ui5Locator } from './Ui5Locator';
import type { Ui5IconTabItem } from './types';

/**
 * Reading and switching a tab bar of `sap.m.IconTabFilter` items - either the full `sap.m.IconTabBar`
 * or, just as commonly, a bare `sap.m.IconTabHeader` on its own (**every method here works against
 * either** - both expose the same `getItems()`/`getSelectedKey()` shape, and this reads them
 * without caring which one it's given). Fiori Elements Object Pages specifically render a bare
 * `IconTabHeader` as the anchor bar's tab strip, not the full `IconTabBar` - confirmed against a
 * real Object Page; see docs/icon-tab-bar.md.
 *
 * Switching a tab is already an ordinary click - a tab is a real control with a real DOM element,
 * so `ui5(page).text('Product Information', { controlType: 'sap.m.IconTabFilter' }).click()` works
 * fine on its own. What a plain locator *can't* get you is the two things this class is for:
 * **reading every tab's key and badge count** (a tab's `key` is rarely its visible text, and a
 * count badge is real bound data buried in a nested `<span>`), and **selecting by that key**
 * instead of by whatever label happens to be showing.
 *
 * ```ts
 * const tabs = ui5(page).controlType('sap.m.IconTabHeader'); // or 'sap.m.IconTabBar'
 * const items = await Ui5IconTabBar.items(page, tabs);
 * expect(items.find((i) => i.text === 'Reviews')?.count).toBe('12');
 *
 * await Ui5IconTabBar.selectByKey(page, tabs, items[1].key!);
 * ```
 */
export class Ui5IconTabBar {
  /** Every tab's id, key, visible text and badge count (`count` is `''` when the app set none -
   * SAPUI5's own default for "no badge", not a read failure). */
  static async items(
    target: Ui5Target,
    iconTabBar: Ui5Locator | Locator,
  ): Promise<Ui5IconTabItem[]> {
    const id = await resolveId(iconTabBar);
    const info = await Ui5Bridge.getIconTabBarInfo(target, id);
    return info.items;
  }

  /** The currently selected tab's key. */
  static async selectedKey(
    target: Ui5Target,
    iconTabBar: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const id = await resolveId(iconTabBar);
    const info = await Ui5Bridge.getIconTabBarInfo(target, id);
    return info.selectedKey;
  }

  /**
   * Selects a tab by its `key` (not its visible text, which changes with translation). Looks up
   * the matching item's own control id via the bridge, then clicks it as an ordinary Playwright
   * click - so it fires exactly the events a real user click would, rather than reaching into the
   * control's internals to force a selection.
   */
  static async selectByKey(
    target: Ui5Target,
    iconTabBar: Ui5Locator | Locator,
    key: string,
    options?: Parameters<Locator['click']>[0],
  ): Promise<void> {
    const id = await resolveId(iconTabBar);
    const itemId = await Ui5Bridge.findIconTabBarItemIdByKey(target, id, key);
    if (!itemId) {
      const info = await Ui5Bridge.getIconTabBarInfo(target, id);
      const known = info.items.map((item) => item.key).join(', ') || '(none)';
      throw new Error(
        `[playwright-sapui5] Ui5IconTabBar.selectByKey: no tab with key "${key}". Known keys: ${known}.`,
      );
    }
    await target.locator(idSelector(itemId)).click(options);
  }
}

async function resolveId(iconTabBar: Ui5Locator | Locator): Promise<string> {
  const locator = iconTabBar instanceof Ui5Locator ? await iconTabBar.resolve() : iconTabBar;
  return locator.first().evaluate((el) => el.id);
}
