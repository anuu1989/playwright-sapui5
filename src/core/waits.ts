import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import type { WaitForUi5Options } from './types';

/**
 * Waits until `sap.ui.getCore()` exists on `target`, i.e. the SAPUI5 runtime has bootstrapped.
 * Useful right after `page.goto()`. Safe to call on non-UI5 pages (it will just time out;
 * catch it or use `waitForUi5` instead, which degrades gracefully).
 *
 * `target` can be a `Page` or a `Frame` - pass a `Frame` (e.g. one found with `findUi5Frame()`)
 * to wait for an embedded app's own SAPUI5 runtime inside an iframe, such as one loaded by a
 * Fiori Launchpad shell. See docs/cross-frame.md.
 */
export async function waitForUi5Core(
  target: Ui5Target,
  options: WaitForUi5Options = {},
): Promise<void> {
  const timeout = options.timeout ?? 30000;
  await Ui5Bridge.ensure(target);
  // `target.waitForFunction(predicate, arg, options)` - same mechanism explained in detail in
  // `src/core/SelfHealingResolver.ts`: the arrow function below runs *inside the browser*,
  // repeatedly, until it returns something truthy or `timeout` elapses. There's no meaningful
  // `arg` to pass here (nothing browser-side needs data from Node for this particular check),
  // which is why the second argument is `undefined`. `Frame` has the exact same
  // `waitForFunction`/`waitForLoadState` methods `Page` does, which is what makes this work
  // unchanged whether `target` is the top-level page or one specific iframe within it.
  await target.waitForFunction(
    () => (window as any).__pwSapUi5__?.isCoreReady() === true,
    undefined,
    {
      timeout,
    },
  );
  // Best-effort: a UI5 app's bootstrap (manifest, component, views, initial OData/mock data) is
  // almost entirely network-bound, but not all of that loading is guaranteed to go through
  // fetch/XHR in a way our own instrumentation can see (e.g. script-tag module loading). Riding
  // Playwright's own network-idle detection here catches it regardless of the mechanism, once,
  // before `waitForUi5` starts polling the control tree for the (much shorter) final settle.
  await target.waitForLoadState('networkidle', { timeout }).catch(() => {
    /* apps with polling, websockets, or analytics beacons may never go fully idle - that's fine */
  });
}

/**
 * Waits until the app looks "settled": no global BusyIndicator, no control-level `busy` state,
 * no in-flight fetch/XHR requests, and the UI5 control tree has stopped growing/changing for a
 * short quiet period. That last part matters as much as the busy checks - right after
 * `page.goto()`, an app's initial component/view bootstrap often doesn't set any busy state or
 * go through fetch/XHR at all, so without it this would return before a single control has
 * rendered. This is the framework's core auto-wait primitive - call it before interacting with
 * controls that might still be loading.
 *
 * On a page where SAPUI5 never loads at all, this still resolves (quickly) rather than throwing,
 * so it's safe to sprinkle liberally.
 *
 * `target` can be a `Page` or a `Frame` - see `waitForUi5Core` above.
 */
export async function waitForUi5(
  target: Ui5Target,
  options: WaitForUi5Options = {},
): Promise<void> {
  const timeout = options.timeout ?? 15000;
  await Ui5Bridge.ensure(target);
  await target.waitForFunction(
    () => {
      // This whole callback body runs in the browser, on every poll tick. `isSettled()` is the
      // one function that actually does the interesting work here (see
      // `src/browser/bridgeScript.ts`) - this predicate is mostly just "is the bridge even
      // installed yet, and if so, ask it." Returning `true` when there's no bridge at all is
      // what lets this function resolve quickly on a page that never boots SAPUI5, instead of
      // hanging until `timeout`.
      const bridge = (window as any).__pwSapUi5__;
      return bridge ? bridge.isSettled() : true;
    },
    undefined,
    { timeout },
  );
}
