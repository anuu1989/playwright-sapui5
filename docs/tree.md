# `Ui5Tree`

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5Tree` reads and expands/collapses `sap.m.Tree` - hierarchical data (org charts, category
trees, nested groupings) rendered as an indented, expandable list.

```ts
const tree = ui5(page).controlType('sap.m.Tree');
const items = await Ui5Tree.items(page, tree);
expect(items.map((i) => i.title)).toEqual(['Node1', 'Node2']);

await Ui5Tree.expand(page, tree, 'Node1');
expect(await Ui5Tree.items(page, tree)).toContainEqual(
  expect.objectContaining({ title: 'Node1-1', level: 1 }),
);
```

## Why this needs a helper at all

Two things make a tree genuinely different from a flat list, not just visually:

- **What's rendered right now is only the visible slice.** A collapsed node's descendants aren't
  merely hidden - unlike a table's off-screen rows, they don't exist in the DOM at all until the
  node is expanded. There's no "read every row" that works before you've expanded anything.
- **"Is this expandable, and is it currently open" isn't visible text.** It has to come from the
  control itself.

`items()` reads the tree's real, currently-rendered node list straight off the control -
`level`/`expanded` come from `sap.m.StandardTreeItem#getLevel()`/`getExpanded()`, verified against
a real `sap.m.Tree` SDK sample, not inferred from indentation or a CSS class. `expand()`/
`collapse()` click each node's own expand toggle, rendered at a verified, predictable id
(`<itemId>-expander`) - a real click, so it fires the control's own `toggleOpenState` event.

## API

```ts
Ui5Tree.items(target, tree): Promise<Ui5TreeItemInfo[]>;
Ui5Tree.expand(target, tree, text): Promise<void>;
Ui5Tree.collapse(target, tree, text): Promise<void>;
Ui5Tree.expandToLevel(target, tree, level): Promise<void>; // 0-based
Ui5Tree.collapseAll(target, tree): Promise<void>;
```

```ts
interface Ui5TreeItemInfo {
  id: string;
  title: string | undefined;
  level: number; // 0-based - a top-level node is level 0
  expanded: boolean | undefined;
  leaf: boolean;
}
```

`expand()`/`collapse()` look up the node by its title text among currently-rendered items, then
click its toggle - a no-op if it's already in the requested state, or a leaf with nothing to
toggle. `expandToLevel()`/`collapseAll()` call the control's own methods of the same name directly
rather than clicking anything: the base `sap.m.Tree` has no single rendered control for "expand
everything to level N" or "collapse everything at once," only the per-node toggle - so, unlike
every other action in this framework, these two are a deliberate exception to "always simulate a
real click," for the same reason `Ui5VariantManagement.selectByKey()` calls `activateVariant()`
directly: there's no other way to trigger the behavior at all.

## Verified

Against the SAPUI5 SDK's own official `sap.m.Tree` sample: `items()` correctly reading the two
top-level nodes ('Node1', 'Node2') with `level: 0` and `expanded: false`; `expand(page, tree,
'Node1')` - a real click on the node's `-expander` span - causing its two children ('Node1-1',
'Node1-2', both `level: 1`) to newly appear in `items()`, in the correct tree order, with the
parent's own `expanded` flipping to `true`. See
[`examples/tests/tree.spec.ts`](../examples/tests/tree.spec.ts).

## Related

- [docs/ui5-table.md](ui5-table.md), [docs/ui5-grid-table.md](ui5-grid-table.md) - the flat-list
  equivalents of this same "row access without guessing at generated ids" approach
