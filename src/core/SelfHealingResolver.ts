import type { Locator, Page } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';
import { idsSelector } from './domSelectors';
import type { HealEvent, HealListener, Ui5ControlInfo, Ui5LocatorCriteria } from './types';

/**
 * This file is where self-healing actually happens - `Ui5Locator` just hands it a list of
 * strategies; everything about *trying them in order* and *falling back* lives here. See
 * docs/architecture.md#flow-2-what-click-actually-does for a full step-by-step trace, and
 * docs/architecture.md#flow-3-self-healing-traced-through-a-failure for a worked example of a
 * fallback actually firing.
 */

/**
 * Turns the plain-data matches the bridge found (`Ui5ControlInfo[]`, just `{ id, type }` pairs -
 * see `src/core/types.ts`) into one real Playwright `Locator`. This is the exact moment where
 * "a UI5 control the bridge found" becomes "a DOM element Playwright can act on" - by building a
 * CSS selector out of each match's `id` (via `idsSelector` - see `src/core/domSelectors.ts`), on
 * the assumption (true for the vast majority of SAPUI5 controls) that the control's own id equals
 * the id attribute on its rendered root DOM element.
 */
function controlsToLocator(page: Page, matches: Ui5ControlInfo[]): Locator {
  if (matches.length === 0) {
    // No matches: rather than return `null`/`undefined` and force every caller to handle that
    // separately, this returns a `Locator` built from a selector that can structurally never
    // match anything on any real page. That keeps the return type a plain `Locator` in every
    // case, and lets `.count()` (0) and `.waitFor()` (behaves like "never found") work exactly
    // as you'd expect without any special-casing here or in `Ui5Locator`.
    return page.locator('[data-playwright-sapui5-no-match]');
  }
  // A comma-separated list of CSS selectors matches *any* of them (CSS's own "selector list"
  // syntax), so multiple matching controls become one `Locator` that covers all of them at once.
  // `Ui5Locator.click()`/etc. then narrow to one with `.first()`.
  return page.locator(idsSelector(matches.map((m) => m.id)));
}

/**
 * Resolves *one* strategy into a Playwright `Locator`, polling until it matches or `timeoutMs`
 * elapses. This function only ever tries a single strategy - the retry-the-next-strategy logic
 * lives one level up, in `SelfHealingResolver.resolve()`'s `for` loop below.
 */
async function resolveCriteria(
  page: Page,
  criteria: Ui5LocatorCriteria,
  timeoutMs: number,
): Promise<Locator> {
  // `criteria.by` is the discriminant of the `Ui5LocatorCriteria` union (see
  // docs/typescript-for-beginners.md#union-types-this-or-that) - checking it narrows which other
  // fields TypeScript knows `criteria` has. The `'css'` and `'role'` cases are handled here,
  // directly in Node, because they're plain Playwright locators with no need to involve the
  // SAPUI5 bridge at all.
  if (criteria.by === 'css') {
    const locator = page.locator(criteria.selector);
    await locator.first().waitFor({ state: 'attached', timeout: timeoutMs });
    return locator;
  }

  if (criteria.by === 'role') {
    const locator = page.getByRole(criteria.role as Parameters<Page['getByRole']>[0], {
      name: criteria.name,
    });
    await locator.first().waitFor({ state: 'attached', timeout: timeoutMs });
    return locator;
  }

  // Every other strategy (`id`, `controlType`, `bindingPath`, `text`) needs the bridge script to
  // actually read SAPUI5's control registry - `Ui5Bridge.ensure()` installs it if this `Page`
  // hasn't seen it yet (a no-op otherwise, see `src/core/Ui5Bridge.ts`).
  await Ui5Bridge.ensure(page);

  const deadline = Date.now() + timeoutMs;
  let matches: Ui5ControlInfo[] = [];
  // Poll in-browser via waitForFunction so we retry while UI5 is still rendering/binding data,
  // instead of treating a transient "not found yet" as a hard failure for this strategy.
  const remaining = () => Math.max(0, deadline - Date.now());

  // `page.waitForFunction(predicate, arg, options)` is Playwright's mechanism for "run this
  // function inside the browser, repeatedly, until it returns something truthy or time runs
  // out." The arrow function below is the `predicate` - it does NOT run here in Node; Playwright
  // serializes it, sends it into the page, and re-invokes it on a timer, entirely inside the
  // browser tab. `args` inside it is `criteria` (the second parameter, `arg`), passed across that
  // same Node/browser boundary as plain JSON - which is exactly why `criteria` can only contain
  // simple, serializable values (strings, numbers, booleans, plain objects), never functions or
  // class instances.
  const handle = await page.waitForFunction(
    (args) => {
      // Everything inside this arrow function runs in the browser. `(window as any).__pwSapUi5__`
      // is the bridge object `bridgeScript()` set up (see `src/browser/bridgeScript.ts`) - `as
      // any` is needed here because TypeScript's built-in browser types have no idea this
      // property exists (it's not part of any standard `Window` interface).
      const bridge = (window as any).__pwSapUi5__;
      if (!bridge) return null;
      let result: Ui5ControlInfo[] = [];
      // This `switch` mirrors the same narrowing `resolveCriteria` did above with `if`, just
      // written as a `switch` since there are four cases here instead of two.
      switch (args.by) {
        case 'id':
          result = bridge.findControlsById(args.value, args.exact);
          break;
        case 'controlType':
          result = bridge.findControlsByType(args.controlType, args.properties);
          break;
        case 'bindingPath':
          result = bridge.findControlsByBindingPath(args.path, args.controlType);
          break;
        case 'text':
          result = bridge.findControlsByText(args.text, args.controlType, args.exact);
          break;
      }
      // `waitForFunction` keeps polling as long as the predicate returns a falsy value (`null`,
      // here, for "nothing matched yet") - returning the array itself once it's non-empty is
      // what actually stops the polling and resolves the wait.
      return result.length ? result : null;
    },
    criteria,
    { timeout: remaining() },
  );
  // `waitForFunction` resolves to a `JSHandle` - a live *reference* to the value inside the
  // browser, not the value itself. `.jsonValue()` copies it across the boundary into a plain
  // Node object (a real `Ui5ControlInfo[]` array you can use normally); `.dispose()` releases
  // the browser-side reference now that we're done with it, so it doesn't leak memory in the page.
  matches = (await handle.jsonValue()) as Ui5ControlInfo[];
  await handle.dispose();

  return controlsToLocator(page, matches);
}

export class SelfHealingResolver {
  // A module-wide list of every `onHeal()` subscriber. `static` means there's exactly one of
  // these per running process, shared by every `Ui5Locator` you create - not one list per
  // locator - which is what makes it possible to subscribe once, globally, and hear about every
  // heal event across your whole test suite.
  private static listeners: HealListener[] = [];

  /** Subscribe to fallback events, e.g. for custom logging/reporting. Returns an unsubscribe function. */
  static onHeal(listener: HealListener): () => void {
    this.listeners.push(listener);
    // Returning a small closure that removes this exact listener is a common pattern for
    // "subscribe" APIs - it means callers don't need to keep track of the listener reference
    // themselves to unsubscribe later; the returned function already has it captured.
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private static emit(event: HealEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A bug in *your* onHeal callback must never break the actual locator resolution it's
        // just observing - so any error a listener throws is silently swallowed here.
        // listener errors must never break locator resolution
      }
    }
  }

  /**
   * Resolves the first strategy in `strategies` that matches, trying each in order.
   * The overall `timeout` budget is split evenly across strategies. Throws if all fail.
   */
  static async resolve(
    page: Page,
    strategies: Ui5LocatorCriteria[],
    options: { timeout?: number; label?: string } = {},
  ): Promise<Locator> {
    if (strategies.length === 0) {
      // This can only happen if something calls this method directly with an empty array -
      // `Ui5Locator` itself always seeds `strategies` with at least the primary strategy in its
      // constructor, so you won't hit this through the normal public API.
      throw new Error('[playwright-sapui5] Ui5Locator has no strategies to resolve.');
    }
    const totalTimeout = options.timeout ?? 10000;
    // Split the overall budget evenly across every strategy, with a 1000ms floor per strategy so
    // a locator with many fallbacks doesn't get an unreasonably short window for each one.
    const perStrategyTimeout = Math.max(1000, Math.floor(totalTimeout / strategies.length));

    let lastError: unknown;
    // A plain, old-style `for (let i = 0; ...)` loop rather than `for...of` because the loop
    // body needs the *index* `i` (to know whether this is the primary strategy, `i === 0`, or a
    // fallback) as well as the value.
    for (let i = 0; i < strategies.length; i++) {
      try {
        const locator = await resolveCriteria(page, strategies[i], perStrategyTimeout);
        // `resolveCriteria` can return successfully with zero matches in one specific case: the
        // `'css'`/`'role'` branches' own `waitFor({ state: 'attached' })` could theoretically
        // resolve just as the element detaches again. This check catches that edge case and
        // routes it through the same "this strategy failed, try the next one" path as a genuine
        // timeout, by throwing here so the `catch` below handles it uniformly.
        if ((await locator.count()) === 0) {
          throw new Error('no matching elements');
        }
        if (i > 0) {
          // Only strategies *after* the primary one (`i > 0`) count as a "heal" - the primary
          // strategy working on the first try is just normal operation, nothing to report.
          const event: HealEvent = {
            label: options.label,
            strategyIndex: i,
            strategy: strategies[i],
            attempt: i + 1,
          };
          this.emit(event);
          // This warning is deliberate and not just debug noise: it's the whole point of
          // self-healing being *visible* rather than silent - see docs/locators.md.
          console.warn(
            `[playwright-sapui5] Self-healed locator "${options.label ?? 'unnamed'}" using fallback #${i + 1}: ${JSON.stringify(
              strategies[i],
            )}`,
          );
        }
        return locator;
      } catch (err) {
        // Don't give up on the very first failure - remember the error (in case every strategy
        // fails and we need to report *something* useful) and let the loop try the next one.
        lastError = err;
      }
    }
    // Every strategy was tried and every one failed (the `for` loop finished without an early
    // `return` above) - only now do we actually throw, bundling in whichever error came from the
    // *last* attempted strategy as the most likely useful clue for debugging.
    throw new Error(
      `[playwright-sapui5] All ${strategies.length} locator strategies failed for "${options.label ?? 'unnamed locator'}". Last error: ${String(lastError)}`,
    );
  }
}
