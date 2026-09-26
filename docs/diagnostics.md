# Failure diagnostics (the control tree, attached automatically)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

When a test that imports `test` from this package fails, the SAPUI5 **control tree** is captured
and attached to the failure automatically. No opt-in, no configuration, no change to existing
tests.

## Why

A failing locator tells you what _isn't_ there:

```
Error: [playwright-sapui5] All 1 locator strategies failed for "Save button".
Last error: TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.
```

Playwright's screenshot shows you the pixels. Neither answers the question you actually have with
a SAPUI5 app: **which controls were there, of what type, with what text?** A SAPUI5 control's
identity lives in the control tree, not in the DOM and certainly not in a picture of it - so the
usual way to find out is to re-run with `--headed`, pause at exactly the right moment, and poke at
`sap.ui.getCore()` in a browser console. That's slow, and it only works if the failure reproduces.

This attaches the answer to the run that already failed.

## What you get

Two attachments on each failed test:

**`ui5-control-tree.txt`** - a readable summary. A type histogram first (what kinds of control were
on the page, most numerous first), then every control carrying visible text, with its id:

```
SAPUI5 control tree: 217 rendered controls

By type:
    20  sap.m.FlexBox
    16  sap.m.StandardListItem
    14  sap.m.Text
    11  sap.m.Button
     1  sap.f.FlexibleColumnLayout
     ...

Controls carrying text (63):
  [sap.m.Title] __title0
      text="Welcome to the Shopping Cart"
  [sap.m.List] container-cart---homeView--categoryList
      headerText="Categories"
  ...
```

**`ui5-control-tree.json`** - the full dump, including parent ids, for grepping or scripting.

The text version is deliberately what you see first: nobody diagnoses a failure by reading four
thousand lines of JSON, but the histogram plus the text list answers the two questions that
actually come up - _was my control there at all?_ and _what text did it really have?_ - in a form
you can scan in seconds.

## Reading them

They're ordinary Playwright attachments, so they appear wherever your reporter puts attachments:

```bash
npx playwright test --reporter=html && npx playwright show-report
```

In the HTML report they're listed under the failed test, next to the screenshot and trace.

## Typical use

The histogram usually resolves the failure on its own. A few patterns worth recognizing:

| What you see                                         | What it usually means                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `No SAPUI5 controls were rendered on this page.`     | UI5 never booted, or the app navigated away - check the URL and whether login intercepted you                                         |
| The control type you expected is **absent**          | the view hadn't rendered yet (add a wait - see [docs/auto-wait.md](auto-wait.md)) or the app renders a different control than assumed |
| The type is present but your **text doesn't appear** | wording/translation mismatch - and the reason to look texts up rather than hardcode them ([docs/i18n.md](i18n.md))                    |
| The type is present **many times over**              | your locator was ambiguous; narrow with `controlType` or a more specific id ([docs/locators.md](locators.md))                         |

## Using it outside a failure

The same functions are exported, so you can capture a snapshot whenever you like - handy while
writing a new test against an unfamiliar app:

```ts
import { captureControlTree } from 'playwright-sapui5';

const { text } = await captureControlTree(page);
console.log(text);
```

`formatControlTree(dump)` and `summarizeByType(dump)` are exported too, if you'd rather render a
dump from [`Ui5Bridge.dumpControlTree()`](api-reference.md#ui5bridge) yourself.

`captureControlTree` never throws - a page that's already closed or navigated away is completely
normal when something has just failed, and diagnostics that blow up while reporting a failure only
bury the real one.

## Note

This comes from the `test` fixture exported by this package. If you import `test` from
`@playwright/test` directly, you get Playwright's behaviour unchanged and no attachments - see
[docs/getting-started.md](getting-started.md#3-your-first-test).
