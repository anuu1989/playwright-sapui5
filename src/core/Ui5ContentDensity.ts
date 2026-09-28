import type { Ui5Target } from './Ui5Bridge';

/** SAPUI5's two content-density CSS classes - `'compact'` for dense, desktop-with-mouse layouts
 * (shorter rows, tighter padding), `'cozy'` for touch-sized hit targets (SAPUI5's own default
 * absent any explicit class). */
export type Ui5ContentDensityValue = 'compact' | 'cozy';

const COMPACT_CLASS = 'sapUiSizeCompact';
const COZY_CLASS = 'sapUiSizeCozy';

/**
 * Reading and forcing SAPUI5's content density - the `sapUiSizeCompact`/`sapUiSizeCozy` CSS
 * class SAPUI5 controls key their sizing off (row height, padding, hit-target size), applied by
 * convention to `<body>`. See docs/content-density.md.
 *
 * The problem this solves: a real Fiori app commonly renders differently depending on density -
 * compact on desktop, cozy on a touch device - and that's driven by nothing more than this one
 * CSS class. Nothing in Playwright itself knows to look for it, so without this, testing both
 * densities means reaching for a raw `page.evaluate()` and hardcoding the class names yourself in
 * every test file that needs it.
 *
 * ```ts
 * await Ui5ContentDensity.set(page, 'compact');
 * // ... assert whatever should look different in compact mode ...
 * ```
 *
 * Deliberately plain DOM, not the SAPUI5 control-tree bridge every other class in this framework
 * goes through - density is a CSS-only concern (it doesn't change what controls exist, only how
 * they're sized), so there's nothing here `sap.ui.getCore()` would add.
 */
export class Ui5ContentDensity {
  /**
   * The density currently in effect, read from `<body>`'s own class list. Returns `null` if
   * neither class is present - a real, valid state (SAPUI5's own default is cozy sizing with *no*
   * class needed at all), not a failure to detect.
   */
  static async get(target: Ui5Target): Promise<Ui5ContentDensityValue | null> {
    return target.evaluate(
      ({ compact, cozy }) => {
        const classList = document.body.classList;
        if (classList.contains(compact)) return 'compact';
        if (classList.contains(cozy)) return 'cozy';
        return null;
      },
      { compact: COMPACT_CLASS, cozy: COZY_CLASS },
    );
  }

  /**
   * Forces `<body>` to the given density - the same `<body>`-class toggle a real Fiori shell's
   * own density-switcher button performs. Takes effect immediately (it's a CSS class, not
   * something SAPUI5 needs to re-render controls for), so no wait is needed afterward.
   */
  static async set(target: Ui5Target, density: Ui5ContentDensityValue): Promise<void> {
    await target.evaluate(
      ({ density, compact, cozy }) => {
        document.body.classList.remove(compact, cozy);
        document.body.classList.add(density === 'compact' ? compact : cozy);
      },
      { density, compact: COMPACT_CLASS, cozy: COZY_CLASS },
    );
  }

  /** Switches to the other density (treating `null` - no class present - as `'cozy'`, SAPUI5's
   * own default) and returns the one now in effect. */
  static async toggle(target: Ui5Target): Promise<Ui5ContentDensityValue> {
    const current = await this.get(target);
    const next: Ui5ContentDensityValue = current === 'compact' ? 'cozy' : 'compact';
    await this.set(target, next);
    return next;
  }
}
