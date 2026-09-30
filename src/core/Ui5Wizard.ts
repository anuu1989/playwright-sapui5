import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { idSelector } from './domSelectors';
import type { Ui5WizardStepInfo } from './types';

/**
 * Step navigation for `sap.m.Wizard` - the guided, multi-step flow controls used for "Create
 * Product"/"Set Up Approval" style processes. See docs/wizard.md.
 *
 * A `Wizard` is awkward for the same reason a `Select` is: the interesting state isn't visible
 * text. Which step is "current" isn't a DOM attribute you can assert on directly (it's the
 * control's own `getCurrentStep()` - verified, against a real `sap.m.Wizard` SDK sample, to
 * return the step *control*, not merely its id), and whether a step lets you move past it is its
 * `validated` property, not anything rendered. This class reads that state straight off the
 * control, and advances the same way a real user would: clicking each step's own "Next" button,
 * which SAPUI5 renders with a verified, predictable id (`<stepId>-nextButton`) - the same
 * "rendering convention as a locator" approach `Ui5Select` uses for a dropdown's `-arrow`.
 *
 * ```ts
 * const wizard = ui5(page).controlType('sap.m.Wizard');
 * const steps = await Ui5Wizard.steps(page, wizard);
 * expect(steps.map((s) => s.title)).toEqual(['Product Type', 'Product Information', ...]);
 *
 * await Ui5Wizard.next(page, wizard); // fills in step 1, clicks its Next button
 * expect(await Ui5Wizard.currentStepIndex(page, wizard)).toBe(1);
 * ```
 */
export class Ui5Wizard {
  /** Every step, in order, with its title and whether it's `validated` (the wizard won't allow
   * moving past an unvalidated step) and `optional`. */
  static async steps(
    target: Ui5Target,
    wizard: Ui5Locator | Locator,
  ): Promise<Ui5WizardStepInfo[]> {
    const info = await Ui5Bridge.getWizardInfo(target, await resolveId(wizard));
    return info.steps;
  }

  /** The control id of the step currently showing. */
  static async currentStepId(
    target: Ui5Target,
    wizard: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const info = await Ui5Bridge.getWizardInfo(target, await resolveId(wizard));
    return info.currentStepId;
  }

  /** The 0-based index of the step currently showing, within `steps()` - usually more useful
   * than the raw id for an assertion like `expect(await Ui5Wizard.currentStepIndex(...)).toBe(2)`. */
  static async currentStepIndex(
    target: Ui5Target,
    wizard: Ui5Locator | Locator,
  ): Promise<number | undefined> {
    const info = await Ui5Bridge.getWizardInfo(target, await resolveId(wizard));
    if (!info.currentStepId) return undefined;
    const index = info.steps.findIndex((step) => step.id === info.currentStepId);
    return index === -1 ? undefined : index;
  }

  /** The wizard's own 1-based `getProgress()` - the furthest step reached so far. Only differs
   * from `currentStepIndex() + 1` once `enableBranching` lets a user jump backward without
   * losing progress on steps already completed ahead of where they are now. */
  static async progress(
    target: Ui5Target,
    wizard: Ui5Locator | Locator,
  ): Promise<number | undefined> {
    const info = await Ui5Bridge.getWizardInfo(target, await resolveId(wizard));
    return info.progress;
  }

  /**
   * Advances from the current step by clicking *that step's own* "Next" button - SAPUI5 renders
   * one per step, at `<stepId>-nextButton`, not a single shared button, since with
   * `renderMode: 'Scroll'` (the default) every activated step stays mounted at once. Throws if
   * the current step has no such button - the last step's is a differently-labelled "finish"
   * action (`finishButtonText`), which this deliberately doesn't guess at clicking.
   */
  static async next(
    target: Ui5Target,
    wizard: Ui5Locator | Locator,
    options: Parameters<Locator['click']>[0] = {},
  ): Promise<void> {
    const wizardId = await resolveId(wizard);
    const info = await Ui5Bridge.getWizardInfo(target, wizardId);
    if (!info.currentStepId) {
      throw new Error(
        `[playwright-sapui5] Ui5Wizard.next: could not read the current step for ${wizardId} - is it really a sap.m.Wizard?`,
      );
    }
    const nextButton = target.locator(idSelector(`${info.currentStepId}-nextButton`));
    if ((await nextButton.count()) === 0) {
      throw new Error(
        `[playwright-sapui5] Ui5Wizard.next: no "Next" button found for step ${info.currentStepId} - it may be the wizard's last step, which uses its own finish action instead.`,
      );
    }
    await nextButton.click(options);
  }
}

/** Accepts either a `Ui5Locator` or an already-resolved Playwright `Locator`, the same as every
 * other control-state helper in this framework - what's actually needed is the exact DOM id. */
async function resolveId(control: Ui5Locator | Locator): Promise<string> {
  const locator = control instanceof Ui5Locator ? await control.resolve() : control;
  return locator.first().evaluate((el) => el.id);
}
