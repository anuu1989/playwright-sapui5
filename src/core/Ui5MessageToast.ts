import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import type { Ui5MessageToastRecord } from './types';

/**
 * Assertions on `sap.m.MessageToast` - the transient "Product added to your cart" popups SAP apps
 * use constantly. See docs/messages.md.
 *
 * A MessageToast is the most awkward thing in SAPUI5 to assert on, for three compounding reasons:
 * it isn't a control (nothing in the element registry, no id, no `isOpen()`), it renders as a bare
 * `<div class="sapMMessageToast">` appended to the body, and **it removes itself after about three
 * seconds**. A test that clicks a button and then looks for the toast is racing that timer, and
 * loses exactly when the machine is slow - which is exactly when CI is slow. That's the classic
 * "passes locally, flakes in the pipeline" failure.
 *
 * This class doesn't look at the DOM at all. The bridge wraps `MessageToast.show()` when it
 * installs, so every toast the app raises is *recorded as it happens* and stays readable long
 * after the toast itself is gone - there's no timer left to race.
 *
 * ```ts
 * await Ui5MessageToast.clear(page);          // ignore anything from earlier in the test
 * await addToCartButton.click();
 * await Ui5MessageToast.waitForText(page, /added to your shopping cart/i);
 * ```
 */
export class Ui5MessageToast {
  /** Every toast recorded so far, oldest first, each with the browser-side timestamp it was
   * raised at. */
  static async all(target: Ui5Target): Promise<Ui5MessageToastRecord[]> {
    return Ui5Bridge.getMessageToasts(target);
  }

  /** Just the texts of every recorded toast, oldest first. */
  static async texts(target: Ui5Target): Promise<string[]> {
    return (await Ui5Bridge.getMessageToasts(target)).map((toast) => toast.text);
  }

  /** Empties the recorded log. Call this immediately before the action under test so a later
   * assertion can only match a toast *that action* raised, not one left over from an earlier step. */
  static async clear(target: Ui5Target): Promise<void> {
    await Ui5Bridge.clearMessageToasts(target);
  }

  /**
   * Waits until some recorded toast matches `expected` (a substring, or a `RegExp` for anything
   * looser) and returns its full text. Because toasts are recorded rather than observed, this
   * matches one raised *before* the call just as happily as one raised during it - so it's safe to
   * call well after the action, with no risk of having "missed" it.
   */
  static async waitForText(
    target: Ui5Target,
    expected: string | RegExp,
    options: { timeout?: number } = {},
  ): Promise<string> {
    const timeout = options.timeout ?? 5000;
    const deadline = Date.now() + timeout;
    const matches = (text: string) =>
      typeof expected === 'string' ? text.includes(expected) : expected.test(text);

    for (;;) {
      const texts = await this.texts(target);
      const hit = texts.find(matches);
      if (hit !== undefined) return hit;
      if (Date.now() >= deadline) {
        throw new Error(
          texts.length === 0
            ? `[playwright-sapui5] Ui5MessageToast.waitForText: no MessageToast was raised within ${timeout}ms (expected one matching ${String(expected)}).`
            : `[playwright-sapui5] Ui5MessageToast.waitForText: no MessageToast matching ${String(expected)} within ${timeout}ms. Recorded toasts: ${JSON.stringify(texts)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
