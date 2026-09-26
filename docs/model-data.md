# Ui5Model (the app's own data)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5Model` reads what the app's models actually hold, rather than what's rendered on screen. See
[`examples/tests/i18n-and-model.spec.ts`](../examples/tests/i18n-and-model.spec.ts) for complete,
real, passing examples.

## Why not just assert on the rendered text?

Rendered text is a lossy, formatted, localized _projection_ of the data underneath it:

| The data        | What the screen shows                                           |
| --------------- | --------------------------------------------------------------- |
| `449.99`        | `"449.99 USD"`, or `"449,99 USD"`, depending on locale          |
| a date object   | whatever display pattern the app configured                     |
| a long string   | truncated, with an ellipsis                                     |
| `34`            | `"34"` - a string now, and only if the column is even displayed |
| any other field | nothing at all, if the UI doesn't render it                     |

So a test asserting on rendered text breaks when formatting changes, can't see anything the UI
chose to hide, and has to re-implement the app's own formatting rules to know what to expect.
Reading the model sidesteps all of it.

## The full entity behind a row

The most useful thing here by far:

```ts
const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));
const { data, path } = await Ui5Model.getBindingContextData(page, await table.row(0));

expect(data).toMatchObject({ Category: 'Notebooks', Price: '449.99' });
expect(path).toBe("/Products('HT-1000')");
```

`getBindingContextData(target, control)` returns the entire object that control is bound to -
every field of it, including ones the row never rendered. That turns "assert on the text in the
third column" into "assert on the record this row **is**".

It accepts either a `Ui5Locator` or an already-resolved Playwright `Locator`, and returns:

- `hasContext` - `false` for a control that exists but isn't bound to anything (a plain container,
  or a row whose data hasn't arrived yet). Distinct from the control not existing at all, which
  throws.
- `path` - the binding path, e.g. `/ProductCategories('AC')`.
- `data` - the bound object.

## Reading by binding path

```ts
const name = await Ui5Model.getProperty(page, "/ProductCategories('AC')/CategoryName");
```

`options.modelName` selects a named model (default: the unnamed/default model). `options.control`
resolves the model relative to one control instead, which matters when a view sets its own model
that the component doesn't have:

```ts
await Ui5Model.getProperty(page, '/someProp', { modelName: 'cartProducts' });
await Ui5Model.getProperty(page, 'relativeProp', { control: someRow });
```

`undefined` comes back both for a path that holds nothing and for a model that doesn't exist - use
`listModels()` if a lookup surprises you.

## <a id="which-models-does-this-app-have"></a>Which models does this app have?

```ts
await Ui5Model.listModels(page); // → ['', 'i18n', 'cartProducts', 'comparison', 'device']
```

Model names are an app-internal detail nothing in the UI exposes, so this is the answer to "what
can I even pass as `modelName`?". `''` is the default, unnamed model.

## A note on serialization

Values cross from the browser into Node as JSON, so anything non-serializable (functions, DOM
nodes) is dropped, and a circular structure comes back as `undefined` rather than throwing. In
practice model data is plain data and this never comes up - but it's why you get `undefined`
rather than a crash if you point this at something exotic.

## Related

- [docs/i18n.md](i18n.md) - the same idea for the app's translated **texts**.
- [docs/expect-matchers.md](expect-matchers.md) - `toHaveUi5Property` reads a _control's_ own
  property; `Ui5Model` reads the _data_ behind it. Both beat scraping rendered text.
