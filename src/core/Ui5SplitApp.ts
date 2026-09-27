import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';

/**
 * Reading a `sap.m.SplitApp`'s current state - the classic master/detail responsive shell
 * (`FlexibleColumnLayout`'s older, simpler sibling; see docs/flexible-column-layout.md if the app
 * you're testing uses that one instead). See docs/split-app.md.
 *
 * The reason this needs a helper: on a narrow screen, `SplitApp` can hide the master page behind
 * a toggle (`ShowHideMode`) or a popover (`PopoverMode`) rather than removing it from the DOM
 * outright - so "is the master page visible?" doesn't reliably answer "is it the current page".
 * `getMode()` and `getCurrentMasterPage()`/`getCurrentDetailPage()` are the control's own honest
 * answers, which is what this reads.
 *
 * ```ts
 * const shell = ui5(page).controlType('sap.m.SplitApp');
 * expect(await Ui5SplitApp.mode(page, shell)).toBe('ShowHideMode');
 * const { detailPage } = await Ui5SplitApp.currentPages(page, shell);
 * ```
 */
export class Ui5SplitApp {
  /** SAPUI5's own `sap.m.SplitAppMode` enum value - `'ShowHideMode'`, `'StretchCompressMode'`,
   * `'PopoverMode'` or `'HideMode'`. */
  static async mode(
    target: Ui5Target,
    splitApp?: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const info = await Ui5Bridge.getSplitAppInfo(target, await resolveId(target, splitApp));
    return info.mode;
  }

  /** Which page is currently showing in the master and detail areas, by control id -
   * `undefined` for whichever side isn't displaying anything (rare, but possible before the app's
   * first navigation). */
  static async currentPages(
    target: Ui5Target,
    splitApp?: Ui5Locator | Locator,
  ): Promise<{ master?: string; detail?: string }> {
    const info = await Ui5Bridge.getSplitAppInfo(target, await resolveId(target, splitApp));
    return { master: info.masterPage, detail: info.detailPage };
  }
}

/** An app almost always has exactly one SplitApp, so the locator is optional - it defaults to
 * finding the single one on the page, the same convention `Ui5FlexibleColumnLayout` uses. */
async function resolveId(target: Ui5Target, splitApp?: Ui5Locator | Locator): Promise<string> {
  if (!splitApp) {
    const found = await Ui5Bridge.findControlsByType(target, 'sap.m.SplitApp');
    if (found.length === 0) {
      throw new Error('[playwright-sapui5] Ui5SplitApp: no sap.m.SplitApp on this page.');
    }
    return found[0].id;
  }
  const locator = splitApp instanceof Ui5Locator ? await splitApp.resolve() : splitApp;
  return locator.first().evaluate((el) => el.id);
}
