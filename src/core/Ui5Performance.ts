import type { Page } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { waitForUi5, waitForUi5Core } from './waits';
import type { Ui5BootstrapTimings, Ui5PerformanceMetrics } from './types';

/**
 * Measuring how long a SAPUI5 app actually takes to become usable. See docs/performance.md.
 *
 * The browser's own load timings are misleading for a UI5 app: `load` fires once the bootstrap
 * script is in, and *then* UI5 starts - pulling in dozens of library modules, instantiating a
 * component, loading views, resolving an OData model's metadata - before a single control renders.
 * A page can report a 250ms `loadEvent` and still be blank for several seconds. So
 * `measureBootstrap()` times the two moments that actually matter to a user:
 *
 * - **core ready** - the SAPUI5 runtime has bootstrapped (`sap.ui.getCore()` exists)
 * - **settled** - no busy indicator, no in-flight requests, control tree stable: the app is done
 *
 * These are the same two waits every test in this framework already performs
 * ([docs/auto-wait.md](../docs/auto-wait.md)) - this just puts a stopwatch on them, so a startup
 * regression shows up as a number rather than as "the suite feels slower lately".
 */
export class Ui5Performance {
  /**
   * Navigates to `url` and times the whole startup. Returns milliseconds from the start of
   * navigation to each milestone, plus the page's load metrics once it's settled.
   *
   * ```ts
   * const timings = await Ui5Performance.measureBootstrap(page, APP_URL);
   * expect(timings.settledMs).toBeLessThan(15000);
   * ```
   */
  static async measureBootstrap(
    page: Page,
    url: string,
    options: { timeout?: number } = {},
  ): Promise<Ui5BootstrapTimings> {
    // Installing the bridge *before* navigating, for the usual reason: `addInitScript` only
    // affects documents that load after it's registered, and the whole point here is to observe
    // the bootstrap from its very first moment. See docs/auto-wait.md.
    await Ui5Bridge.ensure(page);

    const started = Date.now();
    await page.goto(url);
    const navigationMs = Date.now() - started;

    await waitForUi5Core(page, { timeout: options.timeout ?? 30000 });
    const coreReadyMs = Date.now() - started;

    await waitForUi5(page, { timeout: options.timeout ?? 30000 }).catch(() => {
      /* an app that never fully settles still has a meaningful core-ready number */
    });
    const settledMs = Date.now() - started;

    return { navigationMs, coreReadyMs, settledMs, metrics: await this.metrics(page) };
  }

  /**
   * Load metrics for whatever is currently loaded: the browser's navigation timings, how many
   * resources were fetched (and how many of those were UI5's own), and how many controls the app
   * has built.
   *
   * `controlCount` is worth watching on its own - a view that quietly starts rendering thousands
   * of controls is a common cause of a Fiori app getting sluggish, and it shows up here long
   * before anyone files a performance bug.
   */
  static async metrics(target: Ui5Target): Promise<Ui5PerformanceMetrics> {
    return Ui5Bridge.getPerformanceMetrics(target);
  }
}
