import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { waitForUi5 } from './waits';
import type { Ui5ObjectPageSection } from './types';

/**
 * Reading and navigating a `sap.uxap.ObjectPageLayout` - the header + sections layout behind
 * every Fiori Elements object page. See docs/object-page.md.
 *
 * The reason this needs a helper rather than plain locators: an Object Page can render its
 * top-level sections two completely different ways - as clickable tabs (`iconTabBar` mode) or as
 * one long scrollable page with an anchor bar that highlights as you pass each section - and
 * which one a given app uses isn't something a test should have to special-case. Both modes are
 * driven by the same underlying section/subsection structure and the same `scrollToSection()`
 * method under the hood, which is what this class reads and calls instead.
 *
 * ```ts
 * const page = ui5(page).controlType('sap.uxap.ObjectPageLayout');
 * const sections = await Ui5ObjectPage.sections(page, page);
 * await Ui5ObjectPage.scrollToSection(page, page, 'Product Information');
 * ```
 */
export class Ui5ObjectPage {
  /** Every top-level section, each with its own subsections - titles as SAPUI5 rendered them,
   * ids for passing back into `scrollToSection`. */
  static async sections(
    target: Ui5Target,
    objectPage: Ui5Locator | Locator,
  ): Promise<Ui5ObjectPageSection[]> {
    const id = await resolveId(objectPage);
    const info = await Ui5Bridge.getObjectPageInfo(target, id);
    return info.sections;
  }

  /** The id of the top-level section currently in view - the honest answer regardless of display
   * mode: in tab mode it's whichever tab is active, in scroll mode it's whichever section the
   * anchor bar is currently highlighting. */
  static async selectedSection(
    target: Ui5Target,
    objectPage: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const id = await resolveId(objectPage);
    const info = await Ui5Bridge.getObjectPageInfo(target, id);
    return info.selectedSection;
  }

  /**
   * Scrolls (or, in tab mode, switches) to a top-level section by its visible **title**, via the
   * control's own `scrollToSection()` - the same official method SAPUI5's own anchor bar and tab
   * clicks use internally, so this behaves identically in either display mode without needing to
   * know which one the app is in.
   *
   * `scrollToSection()` itself is fire-and-forget - it kicks off an animated scroll, and
   * `getSelectedSection()` only updates once the Object Page's own scroll-spy logic notices the
   * new position, which lags behind by however long the animation takes. Reading
   * `selectedSection()` immediately after calling this **can and does return the previous
   * section** - confirmed against a real Fiori Elements Object Page, where a synchronous read
   * right after the call reported the page's default section instead of the one just scrolled to.
   * So this polls `selectedSection()` itself until it actually reports the target section (or
   * `options.timeout` runs out) before returning, rather than pushing that race onto every caller.
   */
  static async scrollToSection(
    target: Ui5Target,
    objectPage: Ui5Locator | Locator,
    title: string,
    options: { timeout?: number } = {},
  ): Promise<void> {
    const id = await resolveId(objectPage);
    const info = await Ui5Bridge.getObjectPageInfo(target, id);
    const section = info.sections.find((s) => s.title === title);
    if (!section) {
      const known = info.sections.map((s) => s.title).join(', ') || '(none)';
      throw new Error(
        `[playwright-sapui5] Ui5ObjectPage.scrollToSection: no section titled "${title}". Known sections: ${known}.`,
      );
    }
    const result = await Ui5Bridge.scrollObjectPageToSection(target, id, section.id);
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5ObjectPage.scrollToSection failed: ${result.error ?? 'unknown error'}`,
      );
    }

    const timeout = options.timeout ?? 5000;
    const deadline = Date.now() + timeout;
    for (;;) {
      const current = await Ui5Bridge.getObjectPageInfo(target, id);
      if (current.selectedSection === section.id) break;
      if (Date.now() >= deadline) break; // best-effort past this point, as everywhere else
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await waitForUi5(target, { timeout: options.timeout }).catch(() => {
      /* best-effort, as everywhere else - some Object Pages lazy-load a section's content */
    });
  }
}

async function resolveId(objectPage: Ui5Locator | Locator): Promise<string> {
  const locator = objectPage instanceof Ui5Locator ? await objectPage.resolve() : objectPage;
  return locator.first().evaluate((el) => el.id);
}
