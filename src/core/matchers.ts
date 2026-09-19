import type { Locator } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';

/**
 * Custom `expect` matchers that read a SAPUI5 control's *own* live property values, through the
 * bridge, instead of inspecting rendered DOM text - see docs/expect-matchers.md for full usage
 * and why this is a meaningfully different (and sometimes more reliable) thing to assert on than
 * `expect(locator).toHaveText(...)`.
 *
 * This file only *defines* the matchers; they're actually attached to the `expect` this package
 * exports in `src/fixtures/test.ts` (`baseExpect.extend(ui5Matchers)`) - see that file for how
 * `import { expect } from 'playwright-sapui5'` ends up with these available.
 */

/** Resolves either kind of locator this file's matchers accept down to a plain Playwright
 * `Locator` - `Ui5Locator.resolve()` if given one of ours, or the value itself if it's already a
 * plain Playwright `Locator` (e.g. the result of `.resolve()` called ahead of time, or any other
 * Playwright locator you happen to be asserting on). */
async function toPlainLocator(target: Ui5Locator | Locator, timeout: number): Promise<Locator> {
  if (target instanceof Ui5Locator) {
    return target.resolve({ timeout });
  }
  return target;
}

/** Reads the exact DOM id of whatever `locator` currently resolves to - the same id this
 * framework's own control lookups build `[id="..."]` selectors from in the other direction (see
 * docs/core-concepts.md), used here to go from "an already-resolved element" back to "the UI5
 * control it came from," so the matchers below can read that control's *own* properties, not
 * just what ended up in the DOM. */
async function resolvedDomId(locator: Locator): Promise<string> {
  return locator.first().evaluate((el) => el.id);
}

/**
 * Polls `read()` on a fixed interval until `stopWhen(value)` is true or `timeoutMs` elapses, then
 * returns the last value read - the same "keep trying, briefly" idea `Ui5Locator`'s own
 * resolution uses (there, via Playwright's built-in `page.waitForFunction`; here, written out
 * explicitly in plain Node, because the value being checked - an arbitrary UI5 property - isn't
 * itself a DOM element `waitForFunction` could poll for on its own). This is what makes these
 * matchers auto-retrying, the same way Playwright's own built-in assertions (`toBeVisible`,
 * `toHaveText`, ...) are, instead of checking the property exactly once and giving up
 * immediately.
 *
 * Deliberately returns just the last `value`, not a `pass` flag: callers compute `pass` from that
 * value themselves (see `matches()` in each matcher below) - `stopWhen` and `pass` are two
 * different questions once `.not` is involved (see the comment on `matches()` for why).
 */
async function pollUntil<T>(
  read: () => Promise<T>,
  stopWhen: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  // A `for (;;)` loop with an internal `return` - used here instead of a `while` because the loop
  // needs to run its body *at least once* even if `timeoutMs` were somehow already 0, which a
  // `while (Date.now() < deadline)` condition checked up front wouldn't guarantee.
  for (;;) {
    const value = await read();
    if (stopWhen(value)) return value;
    if (Date.now() >= deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * The `this` type every matcher function below declares as its first parameter. Playwright (like
 * Jest before it) calls matcher functions with a rich context object bound to `this`, carrying
 * things like the current test's timeout defaults and formatting helpers - `isNot` is the one
 * piece this file actually needs: `true` when the assertion was written with `.not.` (e.g.
 * `expect(x).not.toBeUi5Busy()`), `false` otherwise. Declaring `this: MatcherThis` as a plain
 * TypeScript parameter (not a real argument - it's erased at compile time) is how you type a
 * function's `this` without changing its actual call signature.
 */
export interface MatcherThis {
  isNot: boolean;
}

export const ui5Matchers = {
  /**
   * Asserts a control's own property equals `expected`, read directly off the live SAPUI5
   * control object (via `control['get' + Name]()`) rather than scraped from rendered DOM text.
   * Comparison is by `===`, so this works well for primitives (strings, numbers, booleans - the
   * overwhelming majority of real property assertions: `text`, `value`, `enabled`, `visible`,
   * `editable`, ...) but won't deep-compare arrays/objects.
   */
  async toHaveUi5Property(
    this: MatcherThis,
    target: Ui5Locator | Locator,
    propertyName: string,
    expected: unknown,
    options: { timeout?: number } = {},
  ) {
    const timeout = options.timeout ?? 5000;
    const notFound = { found: false, hasProperty: false, value: undefined as unknown };
    const matches = (r: typeof notFound) => r.found && r.hasProperty && r.value === expected;

    // The whole point of `this.isNot`: for a plain `toHaveUi5Property(...)`, poll until the
    // property *matches* (or time out still not matching). For `.not.toHaveUi5Property(...)`,
    // poll until it *stops* matching instead (or time out still matching) - without this, a
    // `.not` assertion that's already true on the very first check would still burn through the
    // entire timeout doing nothing, because the old code always polled for the same "matches"
    // condition regardless of which way the assertion was actually written.
    const lastResult = await pollUntil(
      async () => {
        const locator = await toPlainLocator(target, timeout).catch(() => null);
        if (!locator) return notFound;
        const domId = await resolvedDomId(locator).catch(() => null);
        if (!domId) return notFound;
        return Ui5Bridge.getControlProperty(locator.page(), domId, propertyName);
      },
      (result) => matches(result) === !this.isNot,
      timeout,
    );

    // `pass` here is always the *raw*, non-negated answer to "did the property match?" -
    // Playwright/Jest's own `expect` machinery is responsible for flipping this against `isNot`
    // when deciding whether the overall (possibly negated) assertion passed; a custom matcher is
    // never expected to do that inversion itself. See the comment on `message()` below for how
    // that interacts with which message text actually gets shown.
    if (matches(lastResult)) {
      return {
        pass: true,
        message: () =>
          `Expected control not to have property "${propertyName}" = ${String(expected)}, but it did.`,
      };
    }
    if (!lastResult.found) {
      return {
        pass: false,
        message: () =>
          `Expected a control with property "${propertyName}" = ${String(expected)}, but the locator never resolved to a control.`,
      };
    }
    if (!lastResult.hasProperty) {
      return {
        pass: false,
        message: () =>
          `The resolved control has no "${propertyName}" property (no get${propertyName.charAt(0).toUpperCase()}${propertyName.slice(1)}() method).`,
      };
    }
    return {
      pass: false,
      message: () =>
        `Expected property "${propertyName}" to be ${String(expected)}, but it was ${String(lastResult.value)}.`,
    };
  },

  /**
   * Convenience wrapper around `toHaveUi5Property` for the single most common case: a control's
   * visible text, whichever property actually holds it (`text`, `title`, `value`, `label`, or
   * `headerText` - the same candidates `Ui5Locator.text(...)` itself searches by, see
   * `TEXT_GETTERS` in `src/browser/bridgeScript.ts`). Use this instead of `toHaveUi5Property`
   * whenever you'd otherwise have to guess which specific property name a control uses.
   */
  async toHaveUi5Text(
    this: MatcherThis,
    target: Ui5Locator | Locator,
    expected: string,
    options: { timeout?: number } = {},
  ) {
    const timeout = options.timeout ?? 5000;
    const notFound = { found: false, value: undefined as string | undefined };
    const matches = (r: typeof notFound) => r.value === expected;

    const lastResult = await pollUntil(
      async () => {
        const locator = await toPlainLocator(target, timeout).catch(() => null);
        if (!locator) return notFound;
        const domId = await resolvedDomId(locator).catch(() => null);
        if (!domId) return notFound;
        return Ui5Bridge.getControlText(locator.page(), domId);
      },
      (result) => matches(result) === !this.isNot,
      timeout,
    );

    if (matches(lastResult)) {
      return {
        pass: true,
        message: () => `Expected control not to have text "${expected}", but it did.`,
      };
    }
    if (!lastResult.found) {
      return {
        pass: false,
        message: () =>
          `Expected a control with text "${expected}", but the locator never resolved to a control.`,
      };
    }
    return {
      pass: false,
      message: () => `Expected text "${expected}", but it was ${JSON.stringify(lastResult.value)}.`,
    };
  },

  /**
   * Asserts a control's own `busy` property is `true` - a narrower, more precise check than the
   * framework's own `waitForUi5`/`isBusy()` (which ask "is *anything on the whole page* busy?").
   * Use this when you specifically want to know that *one particular* control (a panel, a table,
   * a section) is showing its own busy indicator, e.g. while its own data is loading, regardless
   * of the rest of the page's state. Supports `.not.toBeUi5Busy()` the normal Playwright way -
   * and resolves quickly for the common case of asserting something is settled and *not* busy,
   * rather than always waiting out the full timeout (see the comment on `toHaveUi5Property` above
   * for why that distinction matters).
   */
  async toBeUi5Busy(
    this: MatcherThis,
    target: Ui5Locator | Locator,
    options: { timeout?: number } = {},
  ) {
    const timeout = options.timeout ?? 5000;
    const notFound = { found: false, hasProperty: false, value: undefined as unknown };
    const matches = (r: typeof notFound) => r.found && r.value === true;

    const lastResult = await pollUntil(
      async () => {
        const locator = await toPlainLocator(target, timeout).catch(() => null);
        if (!locator) return notFound;
        const domId = await resolvedDomId(locator).catch(() => null);
        if (!domId) return notFound;
        return Ui5Bridge.getControlProperty(locator.page(), domId, 'busy');
      },
      (result) => matches(result) === !this.isNot,
      timeout,
    );

    if (matches(lastResult)) {
      return { pass: true, message: () => `Expected control not to be busy, but it was.` };
    }
    if (!lastResult.found) {
      return {
        pass: false,
        message: () => `Expected a busy control, but the locator never resolved to a control.`,
      };
    }
    return {
      pass: false,
      message: () =>
        `Expected the control to be busy, but its "busy" property was ${String(lastResult.value)}.`,
    };
  },
};

// TypeScript module augmentation: this teaches the compiler that `expect(...)` results now also
// have `.toHaveUi5Property(...)`, `.toHaveUi5Text(...)`, and `.toBeUi5Busy(...)` available -
// without this block, the matchers above would still work at runtime (JavaScript doesn't care),
// but every call site would show a type error, since Playwright's own built-in `Matchers`
// interface has no idea these three methods exist. `declare module '@playwright/test' { ... }`
// reopens and extends that *existing* interface rather than replacing it - all of Playwright's
// own matchers (`toBeVisible`, `toHaveText`, ...) stay exactly as they were.
declare module '@playwright/test' {
  // `T` has to be repeated here even though these three methods don't use it: augmenting an
  // existing generic interface requires restating its exact type parameter list, not just the
  // ones your own additions happen to need - Playwright's own `Matchers<R, T>` declares both.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R, T> {
    toHaveUi5Property(
      propertyName: string,
      expected: unknown,
      options?: { timeout?: number },
    ): Promise<R>;
    toHaveUi5Text(expected: string, options?: { timeout?: number }): Promise<R>;
    toBeUi5Busy(options?: { timeout?: number }): Promise<R>;
  }
}
