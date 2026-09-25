import { test, expect } from '../../src';
import { ui5, Ui5SmartFilterBar, Ui5SmartTable } from '../../src';

// The UI5 SDK's own sample for SmartFilterBar + SmartTable working together against real (if
// small) mock OData data - not just an empty shell. See docs/smart-controls.md.
const SMART_CONTROLS_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-id=sap.ui.comp.sample.smartfilterbar.Basic&sap-ui-xx-sample-lib=sap.ui.comp&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com';

/**
 * Demonstrates `Ui5SmartFilterBar` and `Ui5SmartTable` - the Fiori Elements "smart controls"
 * pair: a filter bar generated from OData metadata, and a result table whose concrete
 * implementation (`sap.m.Table` vs. the virtualized `sap.ui.table.Table`) is decided at runtime.
 * See docs/smart-controls.md.
 */
test.describe('Ui5SmartFilterBar and Ui5SmartTable', () => {
  test('reading and setting filter values, searching, and reading the true row count', async ({
    page,
  }) => {
    await page.goto(SMART_CONTROLS_SAMPLE_URL);

    const filterBar = await Ui5SmartFilterBar.from(
      ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),
    );
    const smartTable = await Ui5SmartTable.from(
      ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),
    );

    // The sample starts with a default "Company Code = 0001" filter already applied.
    const initial = await filterBar.getFilterData();
    expect(initial.CompanyCode).toMatchObject({
      ranges: [expect.objectContaining({ value1: '0001' })],
    });

    await filterBar.search();
    expect(await smartTable.rowCount()).toBe(4);
    // This sample's SmartTable happens to build a sap.ui.table.Table (a virtualized grid table) -
    // `rowCount()` reads the *true* count from its data binding, not from however many rows are
    // currently rendered in the DOM, which is what makes it reliable for this control type. See
    // docs/smart-controls.md#why-rowcount-does-not-count-dom-rows.
    expect(await smartTable.innerTableType()).toBe('sap.ui.table.Table');

    // Change the filter and search again - a token/range-based field like this one (rendered as
    // a MultiInput with removable tokens) needs the *whole* `{ value, ranges, items }` shape
    // `getFilterData()` itself returned, not a bare replacement value - see
    // docs/smart-controls.md#setfilterdata-needs-the-right-shape-per-field for why.
    await filterBar.setFilterData({
      CompanyCode: {
        value: null,
        ranges: [
          {
            exclude: false,
            operation: 'EQ',
            keyField: 'CompanyCode',
            value1: '9999',
            value2: '9999',
          },
        ],
        items: [],
      },
    });
    await filterBar.search();
    expect(await smartTable.rowCount()).toBe(0);
  });
});
