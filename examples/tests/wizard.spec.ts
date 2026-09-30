import { test, expect } from '../../src';
import { ui5, Ui5Wizard } from '../../src';

// The SAPUI5 SDK's own official sample for sap.m.Wizard.
const WIZARD_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com&sap-ui-xx-sample-id=sap.m.sample.Wizard';

/**
 * Demonstrates `Ui5Wizard` - step navigation for `sap.m.Wizard`, the guided multi-step flow
 * control behind "Create Product"/"Set Up Approval" style processes. See docs/wizard.md.
 */
test.describe('Ui5Wizard', () => {
  test("reads steps and advances by clicking each step's own Next button", async ({ page }) => {
    await page.goto(WIZARD_SAMPLE_URL);

    const wizard = ui5(page).controlType('sap.m.Wizard');

    // Right after navigation the control can exist before its steps aggregation has settled -
    // the same "poll before asserting" caution every other control-state read in this framework
    // needs; see docs/troubleshooting.md.
    await expect.poll(async () => (await Ui5Wizard.steps(page, wizard)).length).toBe(4);

    const steps = await Ui5Wizard.steps(page, wizard);
    expect(steps.map((s) => s.title)).toEqual([
      'Product Type',
      'Product Information',
      'Optional Information',
      'Pricing',
    ]);

    expect(await Ui5Wizard.currentStepIndex(page, wizard)).toBe(0);
    expect(await Ui5Wizard.progress(page, wizard)).toBe(1);

    await Ui5Wizard.next(page, wizard);

    expect(await Ui5Wizard.currentStepIndex(page, wizard)).toBe(1);
    expect(await Ui5Wizard.progress(page, wizard)).toBe(2);
    expect(await Ui5Wizard.currentStepId(page, wizard)).toBe(steps[1].id);
  });
});
