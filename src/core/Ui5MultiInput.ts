import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { idSelector } from './domSelectors';
import type { Ui5TokenInfo } from './types';

/**
 * Adding, reading and removing tokens on `sap.m.MultiInput` (and the same-shaped
 * `sap.m.MultiComboBox`) - the "type to search, pick a suggestion, get a removable chip" fields
 * used for recipient lists, multi-value filters, and the like. See docs/multi-input.md.
 *
 * A token's `key` - the value the app actually binds and filters on - is real bound data with no
 * DOM representation at all (verified against a real `sap.m.MultiInput` SDK sample: only the
 * rendered chip's *text* is in the DOM; the key comes back from `sap.m.Token#getKey()`, straight
 * off the control, the same way `Ui5Select` reads a dropdown option's key). Adding a token means
 * driving the real suggestion flow - type into the field, wait for the popup SAPUI5 renders at
 * `<id>-popup`, click the matching row - rather than calling `addToken()` directly, so the app's
 * own `tokenUpdate` handler fires exactly as it would for a real user.
 *
 * ```ts
 * const field = ui5(page).id('recipientsInput');
 * await Ui5MultiInput.addByText(page, field, 'Astro Laptop 1516');
 * expect(await Ui5MultiInput.tokens(page, field)).toContainEqual(
 *   expect.objectContaining({ key: 'HT-1251', text: 'Astro Laptop 1516' }),
 * );
 * await Ui5MultiInput.removeByText(page, field, 'Astro Laptop 1516');
 * ```
 */
export class Ui5MultiInput {
  /** Every current token, as `{ id, key, text }` - `key` readable here and nowhere else, since
   * it never touches the DOM. */
  static async tokens(
    target: Ui5Target,
    multiInput: Ui5Locator | Locator,
  ): Promise<Ui5TokenInfo[]> {
    const info = await Ui5Bridge.getMultiInputInfo(target, await resolveId(multiInput));
    return info.tokens;
  }

  /**
   * Types `text` into the field, waits for SAPUI5's own suggestion popup, and clicks the
   * suggestion row whose visible text matches - the same sequence a real user performs, so the
   * app's own `suggestionItemSelected`/`tokenUpdate` handlers run normally.
   *
   * Matching is exact by default; pass `{ exact: false }` for a suggestion row that carries more
   * than just the label (e.g. a code alongside the name).
   *
   * Doesn't return the moment the row is clicked - it then polls the control's own token count
   * until it actually increases. Verified necessary against a real `sap.m.MultiInput` SDK sample:
   * the new token is already visible in the DOM's own Tokenizer at the moment the click resolves,
   * but the control's `getTokens()` aggregation can still briefly lag behind it, so a read right
   * after the click can otherwise race that gap and see nothing.
   */
  static async addByText(
    target: Ui5Target,
    multiInput: Ui5Locator | Locator,
    text: string,
    options: { exact?: boolean; timeout?: number } = {},
  ): Promise<void> {
    const id = await resolveId(multiInput);
    const exact = options.exact ?? true;
    const timeout = options.timeout ?? 5000;

    // Captured before typing anything, so the "did a token actually land" wait below can't be
    // fooled by tokens the field already had.
    const before = (await Ui5Bridge.getMultiInputInfo(target, id)).tokens.length;

    const input = target.locator(idSelector(id)).locator('input');
    await input.click();
    await input.fill(text);

    const popup = target.locator(idSelector(`${id}-popup`));
    const rows = popup.locator('.sapMLIB');
    const match = exact
      ? rows.filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) })
      : rows.filter({ hasText: text });

    let count = 0;
    try {
      await match.first().waitFor({ state: 'visible', timeout });
      count = await match.count();
    } catch {
      count = 0;
    }
    if (count === 0) {
      throw new Error(
        `[playwright-sapui5] Ui5MultiInput.addByText: no suggestion ${exact ? `matching "${text}"` : `containing "${text}"`} appeared for ${id} within ${timeout}ms.`,
      );
    }
    await match.first().click();

    // See the method doc above for why this wait can't be skipped.
    await waitForTokenCount(target, id, before + 1, timeout);
  }

  /**
   * Removes the token whose visible text matches `text`, by clicking its own delete icon
   * (`<tokenId>-icon` - SAPUI5's rendering convention for a token's close button, verified
   * against a real control) - a real click, so the app's own `tokenUpdate` handler fires.
   */
  static async removeByText(
    target: Ui5Target,
    multiInput: Ui5Locator | Locator,
    text: string,
  ): Promise<void> {
    const id = await resolveId(multiInput);
    const info = await Ui5Bridge.getMultiInputInfo(target, id);
    const match = info.tokens.find((token) => token.text === text);
    if (!match) {
      throw new Error(
        `[playwright-sapui5] Ui5MultiInput.removeByText: no token with text "${text}". Current tokens: ${JSON.stringify(info.tokens.map((t) => t.text))}`,
      );
    }
    await target.locator(idSelector(`${match.id}-icon`)).click();
  }

  /** Removes every current token, one delete-icon click at a time (see `removeByText` above) -
   * useful to reset a field between assertions without navigating away. */
  static async removeAll(target: Ui5Target, multiInput: Ui5Locator | Locator): Promise<void> {
    const id = await resolveId(multiInput);
    for (;;) {
      const info = await Ui5Bridge.getMultiInputInfo(target, id);
      if (info.tokens.length === 0) return;
      await target.locator(idSelector(`${info.tokens[0].id}-icon`)).click();
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Polls the control's own token count until it reaches `expected` - see the comment on the
 * `addByText` call site for why a read right after the click can otherwise race the control's
 * asynchronous suggestion-commit handling. */
async function waitForTokenCount(
  target: Ui5Target,
  id: string,
  expected: number,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const info = await Ui5Bridge.getMultiInputInfo(target, id);
    if (info.tokens.length >= expected) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `[playwright-sapui5] Ui5MultiInput.addByText: the suggestion was clicked, but ${id}'s token count never reached ${expected} within ${timeout}ms (still ${info.tokens.length}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Accepts either a `Ui5Locator` or an already-resolved Playwright `Locator`, the same as every
 * other control-state helper in this framework - what's actually needed is the exact DOM id. */
async function resolveId(control: Ui5Locator | Locator): Promise<string> {
  const locator = control instanceof Ui5Locator ? await control.resolve() : control;
  return locator.first().evaluate((el) => el.id);
}
