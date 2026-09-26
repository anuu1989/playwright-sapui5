import { test, expect } from '../../src';
import { ui5, Ui5DatePicker, Ui5Select } from '../../src';

// Each of these is the SAPUI5 SDK's own official sample for that control.
const sample = (id: string) =>
  `https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com&sap-ui-xx-sample-id=${id}`;

/**
 * Demonstrates `Ui5Select` (dropdowns, where the items you can *read* are not the items you can
 * *click*) and `Ui5DatePicker` (dates, without hardcoding a locale's display format). See
 * docs/form-inputs.md.
 */
test.describe('Form input controls', () => {
  test('sap.m.Select: read options, then pick one by text and by key', async ({ page }) => {
    await page.goto(sample('sap.m.sample.Select'));

    const select = ui5(page).controlType('sap.m.Select');

    // Options are readable straight off the control - keys included, and without opening the
    // dropdown first. An ordinary locator can't do either.
    //
    // `expect.poll` first because `Ui5Select.items()` reads the control once and doesn't
    // auto-wait: right after navigation the control can exist before its items have finished
    // binding, which shows up as an empty list only under parallel load. See
    // docs/troubleshooting.md.
    await expect.poll(async () => (await Ui5Select.items(page, select)).length).toBeGreaterThan(1);
    const items = await Ui5Select.items(page, select);
    expect(items.length).toBeGreaterThan(1);
    expect(items[0]).toMatchObject({ key: expect.any(String), text: expect.any(String) });

    // Pick something that isn't already selected, so the assertion actually proves a change.
    const current = await Ui5Select.selectedKey(page, select);
    const other = items.find((item) => item.key !== current)!;

    await Ui5Select.selectByText(page, select, other.text!);
    expect(await Ui5Select.selectedKey(page, select)).toBe(other.key);

    // Selecting by key is usually the more stable choice: it's the value the app binds on, so it
    // survives the label being retranslated or reworded.
    await Ui5Select.selectByKey(page, select, items[0].key!);
    expect(await Ui5Select.selectedKey(page, select)).toBe(items[0].key);
  });

  test('sap.m.ComboBox: the rendered list is a different control set entirely', async ({
    page,
  }) => {
    await page.goto(sample('sap.m.sample.ComboBox'));

    const combo = ui5(page).controlType('sap.m.ComboBox');

    // 70 countries, none of which have any DOM element at all while the dropdown is shut - and
    // once it opens, what renders is a *separate* set of sap.m.StandardListItem controls carrying
    // no keys. Ui5Select bridges the two; see docs/form-inputs.md.
    await expect.poll(async () => (await Ui5Select.items(page, combo)).length).toBeGreaterThan(50);
    const items = await Ui5Select.items(page, combo);
    expect(items.length).toBeGreaterThan(50);

    await Ui5Select.selectByText(page, combo, 'Germany');
    expect(await Ui5Select.selectedKey(page, combo)).toBe('GER');

    await Ui5Select.selectByKey(page, combo, 'AR');
    expect(await Ui5Select.selectedKey(page, combo)).toBe('AR');
  });

  test('sap.m.MultiComboBox: several selections in a row', async ({ page }) => {
    await page.goto(sample('sap.m.sample.MultiComboBox'));

    const multi = ui5(page).controlType('sap.m.MultiComboBox');
    await expect.poll(async () => (await Ui5Select.items(page, multi)).length).toBeGreaterThan(1);
    const items = await Ui5Select.items(page, multi);

    // A MultiComboBox deliberately keeps its list open after each pick, so selections just stack.
    await Ui5Select.selectByText(page, multi, items[0].text!);
    await Ui5Select.selectByText(page, multi, items[1].text!);
    await Ui5Select.close(page, multi);

    expect(await Ui5Select.selectedKeys(page, multi)).toEqual([items[0].key, items[1].key]);
  });

  test('sap.m.DatePicker: set a date without knowing the display format', async ({ page }) => {
    await page.goto(sample('sap.m.sample.DatePicker'));

    const picker = ui5(page).controlType('sap.m.DatePicker');

    // A 'YYYY-MM-DD' string never goes through Date parsing, so it can't be shifted a day by the
    // machine's timezone - the classic off-by-one that only fails for some contributors.
    await Ui5DatePicker.setDate(page, picker, '2024-03-15');

    const { date, displayValue } = await Ui5DatePicker.getDate(page, picker);
    expect(date?.getFullYear()).toBe(2024);
    expect(date?.getMonth()).toBe(2); // 0-based: March
    expect(date?.getDate()).toBe(15);

    // The field renders it in whatever format this app/locale uses - which the test never had to
    // know, and deliberately doesn't assert an exact string for.
    expect(displayValue).not.toBe('');

    // A Date works too, read in local time so it's the day you'd see on screen.
    await Ui5DatePicker.setDate(page, picker, new Date(2020, 0, 31));
    expect((await Ui5DatePicker.getDate(page, picker)).date?.getDate()).toBe(31);

    // Anything that isn't a Date or 'YYYY-MM-DD' is rejected up front rather than silently
    // producing the wrong day.
    await expect(Ui5DatePicker.setDate(page, picker, '15/03/2024')).rejects.toThrow(
      /expected a Date or a 'YYYY-MM-DD' string/,
    );
  });
});
