import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import type { Ui5MessageInfo } from './types';

/**
 * Reads SAPUI5's own **message model** - the central place validation errors, OData backend
 * errors and app-raised messages all collect, and what a Fiori app's message popover renders from.
 * See docs/messages.md.
 *
 * This is the reliable way to assert "the form reported exactly this error". The alternative -
 * hunting for whichever control happens to render the message - is brittle twice over: the
 * message might surface in a value-state tooltip, a message strip, a popover behind a footer
 * button, or a dialog, depending on how the app was built; and an OData error might not be
 * rendered anywhere at all while still being the reason your test's next step fails.
 *
 * ```ts
 * await saveButton.click();
 * expect(await Ui5Messages.errors(page)).toEqual([]);   // nothing went wrong
 * ```
 */
export class Ui5Messages {
  /** Every message currently in the model - validation, backend and app-raised alike. */
  static async all(target: Ui5Target): Promise<Ui5MessageInfo[]> {
    return Ui5Bridge.getUi5Messages(target);
  }

  /** Only the messages of SAPUI5 `MessageType` `'Error'`. The most common assertion by far is
   * that this is empty after an action. */
  static async errors(target: Ui5Target): Promise<Ui5MessageInfo[]> {
    return (await this.all(target)).filter((message) => message.type === 'Error');
  }

  /** Only the messages of SAPUI5 `MessageType` `'Warning'`. */
  static async warnings(target: Ui5Target): Promise<Ui5MessageInfo[]> {
    return (await this.all(target)).filter((message) => message.type === 'Warning');
  }

  /**
   * Waits until a message matching `expected` (substring, or `RegExp`) is in the model, and
   * returns it. Unlike toasts, messages aren't transient - they stay until something clears them -
   * so this is a straightforward "wait for it to show up", with no race to worry about.
   */
  static async waitForMessage(
    target: Ui5Target,
    expected: string | RegExp,
    options: { timeout?: number; type?: string } = {},
  ): Promise<Ui5MessageInfo> {
    const timeout = options.timeout ?? 5000;
    const deadline = Date.now() + timeout;
    const matches = (message: Ui5MessageInfo) => {
      if (options.type && message.type !== options.type) return false;
      const text = message.message ?? '';
      return typeof expected === 'string' ? text.includes(expected) : expected.test(text);
    };

    for (;;) {
      const messages = await this.all(target);
      const hit = messages.find(matches);
      if (hit) return hit;
      if (Date.now() >= deadline) {
        throw new Error(
          `[playwright-sapui5] Ui5Messages.waitForMessage: no message matching ${String(expected)} within ${timeout}ms. Current messages: ${JSON.stringify(messages)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Removes every message from the model. Useful between steps, so an assertion about step two
   * can't be satisfied (or broken) by an error raised during step one. Returns `false` if this
   * UI5 version exposed no way to do it. */
  static async clear(target: Ui5Target): Promise<boolean> {
    return Ui5Bridge.clearUi5Messages(target);
  }
}
