import { test, expect } from '../../src';
import { ui5, Ui5Tree } from '../../src';

// The SAPUI5 SDK's own official sample for sap.m.Tree.
const TREE_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com&sap-ui-xx-sample-id=sap.m.sample.Tree';

/**
 * Demonstrates `Ui5Tree` - reading and expanding/collapsing `sap.m.Tree`, where a collapsed
 * node's children aren't merely hidden but genuinely don't exist in the DOM until expanded. See
 * docs/tree.md.
 */
test.describe('Ui5Tree', () => {
  test('reads top-level nodes, expands one, and reads its now-rendered children', async ({
    page,
  }) => {
    await page.goto(TREE_SAMPLE_URL);

    const tree = ui5(page).controlType('sap.m.Tree');

    await expect.poll(async () => (await Ui5Tree.items(page, tree)).length).toBeGreaterThan(0);

    const before = await Ui5Tree.items(page, tree);
    expect(before.map((i) => ({ title: i.title, level: i.level }))).toEqual([
      { title: 'Node1', level: 0 },
      { title: 'Node2', level: 0 },
    ]);
    expect(before[0].expanded).toBe(false);

    await Ui5Tree.expand(page, tree, 'Node1');

    const after = await Ui5Tree.items(page, tree);
    expect(after.map((i) => ({ title: i.title, level: i.level }))).toEqual([
      { title: 'Node1', level: 0 },
      { title: 'Node1-1', level: 1 },
      { title: 'Node1-2', level: 1 },
      { title: 'Node2', level: 0 },
    ]);
    expect(after[0].expanded).toBe(true);
  });
});
