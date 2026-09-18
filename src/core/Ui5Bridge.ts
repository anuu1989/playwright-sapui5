import type { Page } from '@playwright/test';
import { bridgeScript } from '../browser/bridgeScript';
import type { Ui5ControlDump, Ui5ControlInfo } from './types';

// One shared `WeakSet` tracking every `Page` this class has already installed the bridge onto.
// A `WeakSet` (rather than a plain `Set`) is used specifically because it holds *weak*
// references: it won't prevent a closed/garbage-collected `Page` object from actually being
// freed from memory, which a normal `Set` would (it holds strong references, keeping every
// `Page` it has ever seen alive forever - a memory leak in a long test run with many pages).
const initializedPages = new WeakSet<object>();

/**
 * Node-side access point to the in-browser UI5 bridge. Handles injecting the bridge script
 * exactly once per `Page`, and exposes typed methods that call into it.
 *
 * Most consumers should use `Ui5Locator` / `Ui5Page` instead of this class directly - it's
 * exposed for advanced use cases (e.g. the Page Object generator, or custom wait conditions).
 *
 * Every method here follows the exact same three-line shape: `ensure()` the bridge is installed,
 * then `page.evaluate(...)` to call one specific function on `window.__pwSapUi5__` and bring its
 * return value back to Node. See `src/browser/bridgeScript.ts` for what each of those bridge
 * functions actually does, and docs/architecture.md for the full Node ↔ browser picture.
 */
export class Ui5Bridge {
  /** Ensures the bridge is present on `page`, for both the current document and future navigations. */
  static async ensure(page: Page): Promise<void> {
    // Skip the (small but non-zero) cost of re-registering the bridge if this exact `Page`
    // object has already been set up - `Ui5Locator`, `waitForUi5`, `Ui5Page.goto()`, and this
    // class's own other methods all call `ensure()` defensively before doing anything, so
    // without this check, a single test could end up calling it dozens of times.
    if (initializedPages.has(page)) return;
    initializedPages.add(page);
    // `page.addInitScript(fn)` tells Playwright: "run `fn` inside the browser, before any of the
    // page's own scripts, on every future navigation this `Page` makes." It does NOT run
    // immediately and does NOT affect a document that's already loaded - which is exactly why
    // the very next line exists.
    await page.addInitScript(bridgeScript);
    // addInitScript only affects future navigations; inject into the current document too.
    await page.evaluate(bridgeScript).catch(() => {
      /* page may not have a document yet (e.g. about:blank restrictions) - safe to ignore */
    });
  }

  static async isCoreReady(page: Page): Promise<boolean> {
    await this.ensure(page);
    // `(window as any).__pwSapUi5__?.isCoreReady() ?? false` - two pieces worth calling out for
    // beginners: `?.` ("optional chaining") means "if `__pwSapUi5__` is undefined, stop here and
    // produce `undefined` instead of throwing"; `?? false` ("nullish coalescing") then converts
    // that possible `undefined` into a real `boolean`, so this function's declared return type
    // (`Promise<boolean>`) is always honestly met - see docs/typescript-for-beginners.md.
    return page.evaluate(() => (window as any).__pwSapUi5__?.isCoreReady() ?? false);
  }

  static async isBusy(page: Page): Promise<boolean> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__?.isBusy() ?? false);
  }

  static async findControlsById(
    page: Page,
    idSuffix: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    // `page.evaluate(fn, arg)` - same shape as `page.waitForFunction` in
    // `SelfHealingResolver.ts`, just without the "keep retrying" behavior: it runs `fn` once,
    // inside the browser, with `arg` passed in as plain data, and returns whatever `fn` returns.
    // The destructured `{ idSuffix, exact }` parameter here is the *browser-side* copy of the
    // Node-side `idSuffix`/`exact` values above - two separate variables with the same names,
    // living on two separate sides of the Node/browser boundary.
    return page.evaluate(
      ({ idSuffix, exact }) => (window as any).__pwSapUi5__.findControlsById(idSuffix, exact),
      { idSuffix, exact },
    );
  }

  static async findControlsByType(
    page: Page,
    controlType: string,
    properties?: Record<string, unknown>,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ controlType, properties }) =>
        (window as any).__pwSapUi5__.findControlsByType(controlType, properties),
      { controlType, properties },
    );
  }

  static async findControlsByBindingPath(
    page: Page,
    path: string,
    controlType?: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ path, controlType }) =>
        (window as any).__pwSapUi5__.findControlsByBindingPath(path, controlType),
      { path, controlType },
    );
  }

  static async findControlsByText(
    page: Page,
    text: string,
    controlType?: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ text, controlType, exact }) =>
        (window as any).__pwSapUi5__.findControlsByText(text, controlType, exact),
      { text, controlType, exact },
    );
  }

  /** Used by the Page Object generator (`pw-sapui5 generate`) - see `src/generator/cli.ts`. */
  static async dumpControlTree(page: Page): Promise<Ui5ControlDump[]> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__.dumpControlTree());
  }
}
