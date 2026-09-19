import type { Locator, Page } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';
import { idsSelector } from './domSelectors';

/**
 * A small helper for `sap.m.Dialog` / `sap.m.Popover` (and anything else implementing the same
 * `isOpen()` method - `sap.m.MessageBox`'s underlying dialog included): wait for one to open,
 * find its buttons by text without accidentally matching a same-labeled button elsewhere on the
 * page, and wait for it to close again. See docs/ui5-dialog.md.
 *
 * Unlike `Ui5Locator`, this isn't self-healing or chainable - a dialog is a single, specific
 * thing you're interacting with at one point in a test, not a repeatable lookup strategy, so it
 * doesn't need that machinery.
 */
export class Ui5Dialog {
  private constructor(
    private readonly page: Page,
    private readonly containerId: string,
  ) {}

  /**
   * Waits for *some* dialog/popover to be open (`isOpen() === true`) and wraps it. Call this
   * *after* whatever action triggers it (clicking a "Sort"/"Filter"/"Settings" button, an
   * `sap.m.MessageBox.confirm(...)` call in your app's own code, ...) - this doesn't trigger
   * anything itself, it only waits for the result.
   *
   * If more than one dialog/popover happens to be open at once, this wraps whichever one the
   * bridge's control-registry scan happens to return first - for the common case of "I just
   * triggered exactly one dialog," that ambiguity never arises.
   */
  static async open(page: Page, options: { timeout?: number } = {}): Promise<Ui5Dialog> {
    const timeout = options.timeout ?? 5000;
    const deadline = Date.now() + timeout;
    for (;;) {
      const popups = await Ui5Bridge.findOpenPopups(page);
      if (popups.length > 0) {
        return new Ui5Dialog(page, popups[0].id);
      }
      if (Date.now() >= deadline) {
        throw new Error(`[playwright-sapui5] No open dialog/popover found within ${timeout}ms.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * This dialog's own `title` property, if it has one set directly (via `getControlProperty` -
   * see `src/core/matchers.ts` for the same underlying mechanism). Some dialogs (notably
   * `sap.m.ViewSettingsDialog`) build their own header out of a separate toolbar/title control
   * instead of using this property directly, in which case it comes back as an empty string -
   * use `.button(...)`/`.buttonWithText(...)` style scoped lookups for anything inside the
   * dialog that isn't its own `title` in that case.
   */
  async title(): Promise<string> {
    const result = await Ui5Bridge.getControlProperty(this.page, this.containerId, 'title');
    return typeof result.value === 'string' ? result.value : '';
  }

  /**
   * The button inside this specific dialog whose visible text matches `text` - scoped the same
   * way `Ui5Table.rowContaining` scopes to one table's own rows, so a same-labeled "OK" button
   * elsewhere on the page (in a different, already-closed dialog, say) is never a false match.
   */
  async button(text: string): Promise<Locator> {
    const buttons = await Ui5Bridge.findDescendantControlsByType(
      this.page,
      this.containerId,
      'sap.m.Button',
    );
    const candidates = this.page.locator(idsSelector(buttons.map((b) => b.id)));
    return candidates.filter({ hasText: text }).first();
  }

  /** Convenience: `.button(text)` then `.click()` on it, in one call. */
  async clickButton(text: string, options: Parameters<Locator['click']>[0] = {}): Promise<void> {
    const button = await this.button(text);
    await button.click(options);
  }

  /**
   * Waits until this dialog is no longer open - either because it reports `isOpen() === false`,
   * or because it's gone from the control registry entirely (some dialogs are destroyed, not
   * just hidden, on close). Useful after `.clickButton('OK')`/`.clickButton('Cancel')` to make
   * sure the rest of your test doesn't proceed while a closing animation is still in flight.
   */
  async waitForClose(options: { timeout?: number } = {}): Promise<void> {
    const timeout = options.timeout ?? 5000;
    const deadline = Date.now() + timeout;
    for (;;) {
      const popups = await Ui5Bridge.findOpenPopups(this.page);
      if (!popups.some((p) => p.id === this.containerId)) return;
      if (Date.now() >= deadline) {
        throw new Error(`[playwright-sapui5] Dialog did not close within ${timeout}ms.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
