import { test, expect } from '../../src';
import { ui5, Ui5Bridge } from '../../src';

// The SAPUI5 SDK's "Team Calendar" demo app - built around `sap.m.PlanningCalendar`, a
// resource-row-by-date-column scheduling control genuinely different from anything else in this
// framework's examples: no locator-friendly table/list rows, appointments that render as one
// control type across every visible date, and a view (Day/Week/Month) that changes how many of
// them are even rendered. Demonstrates that this framework's general-purpose primitives
// (`ui5()`, `Ui5Bridge.findControlsByType`) handle a control like this without needing a
// dedicated helper class - unlike `Ui5Table`/`Ui5GridTable`, PlanningCalendar's appointments don't
// need scoped/virtualized row access, just an ordinary control-type search. See docs/demo-apps.md.
const TEAM_CALENDAR_URL =
  'https://ui5.sap.com/test-resources/sap/m/demokit/teamCalendar/webapp/index.html?sap-ui-theme=sap_horizon';

test.describe('sap.m.PlanningCalendar (Team Calendar)', () => {
  test('reads resource rows and appointments, and switching views changes what is rendered', async ({
    page,
  }) => {
    await page.goto(TEAM_CALENDAR_URL);

    // `Ui5Bridge.findControlsByType` reads the control tree once and doesn't auto-wait the way
    // `Ui5Locator`'s own actions do - `.waitFor()` here waits for the app to settle before the raw
    // bridge calls below, the same auto-wait every other example gets for free from its first
    // `.click()`/`.fill()`.
    await ui5(page).controlType('sap.m._PlanningCalendarRowHeader').waitFor({ timeout: 15000 });

    // Resource row headers (team member names) are `sap.m._PlanningCalendarRowHeader` controls -
    // a private-ish control type (the leading `_`), but findable the same way as any other, since
    // this framework's locators work off a control's actual runtime type name, not its public API
    // surface.
    const resourceRows = await Ui5Bridge.findControlsByType(
      page,
      'sap.m._PlanningCalendarRowHeader',
    );
    expect(resourceRows.length).toBeGreaterThan(0);
    await expect(await ui5(page).text('John Miller').resolve()).toBeVisible();

    // The default view is "Month" - appointments render as `sap.ui.unified.CalendarAppointment`
    // controls, one per visible occurrence across the whole displayed date range.
    const monthAppointments = await Ui5Bridge.findControlsByType(
      page,
      'sap.ui.unified.CalendarAppointment',
    );
    expect(monthAppointments.length).toBeGreaterThan(0);

    // The Day/Week/Month toggle is an `sap.m.SegmentedButton` - but its individual
    // `SegmentedButtonItem`s are non-visual aggregation items with no DOM element of their own;
    // the actual rendered, clickable element is the paired `sap.m.Button` each one wraps. Always
    // check `controlType` this way (find the control that actually renders) rather than assuming
    // whichever type happens to hold the text you're looking for.
    await ui5(page).text('Week', { controlType: 'sap.m.Button' }).click();
    // The individual buttons' own `type` property doesn't change when selected (still
    // `'Default'`) - the SegmentedButton's own `selectedKey` is the real, verified signal for
    // which item is currently active.
    await expect(await ui5(page).controlType('sap.m.SegmentedButton').resolve()).toHaveUi5Property(
      'selectedKey',
      'Week',
    );

    // Switching from Month to Week changes the visible date range, and with it, how many
    // appointments are actually rendered - a real, verifiable side effect of the view switch, not
    // just a visual change.
    //
    // `expect.poll` rather than a plain read: `Ui5Bridge.findControlsByType` answers "what's in
    // the control tree *right now*" and doesn't auto-wait the way `Ui5Locator`'s actions do, so
    // reading it once immediately after the click races the calendar's re-render. This passed
    // consistently in isolation and then failed under full-suite parallel load - which is exactly
    // how that class of flake shows up. Polling re-reads until the count settles.
    await expect
      .poll(
        async () =>
          (await Ui5Bridge.findControlsByType(page, 'sap.ui.unified.CalendarAppointment')).length,
      )
      .toBeLessThan(monthAppointments.length);
  });
});
