# API catalog (what the UI actually calls)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

This generates a catalog of the real API traffic your test suite's UI drives - every distinct
endpoint the app actually called, how many times, and one real sample request and response for
each. Not a page-load crawl: it's built from **whatever your existing tests actually do**, so a
suite that clicks through real user journeys produces a far richer catalog than anything a
page-load-only tool could ever see.

```ts
// playwright.config.ts
reporter: [['list'], ['playwright-sapui5/reporter/api-catalog']],
```

That's the whole setup - no change to existing tests. Run your suite as usual, and a
`api-catalog.md` shows up afterward:

```
[playwright-sapui5] API catalog: 4 endpoint(s) from 65 captured call(s) written to api-catalog.md
```

```md
# API Catalog

4 distinct endpoints captured from real test traffic.

## GET /sap/opu/odata/.../ProductSet(...)

Called 12 times.

**Sample response** (status 200):

\`\`\`json
{
"d": { "ProductID": "HT-1000", "Name": "Notebook Basic 15", ... }
}
\`\`\`
```

## How it works

A fixture built into this package's `test` (`ui5ApiCatalog`) records each test's network traffic
and attaches it to the test result. The reporter reads that attachment back across every test in
the run and writes the combined catalog once, at the end - the same
attach-in-the-worker-read-in-the-reporter pattern [`JiraReporter`](jira.md) and
[`HealthReporter`](locator-health.md) already use, for the same reason: a reporter runs in a
different process from the one a test worker executes in, so it can't just listen for the traffic
itself.

## What gets captured, by default

Responses whose content type looks like data (JSON, XML, multipart) **and** whose URL doesn't
match a well-known SAPUI5 framework resource pattern - `manifest.json`, `*.view.xml`,
`*.fragment.xml`, i18n/message bundles, CLDR data, `sap-ui-version.json`, anything under
`/resources/sap/`. This is a heuristic, not a guarantee - pass your own filter if your app's real
API happens to collide with one of these, or if you want framework traffic included too:

```ts
import { startApiCapture } from 'playwright-sapui5';

startApiCapture(page, {
  filter: (info) => info.url.includes('/my-service/'),
});
```

(`startApiCapture` is the function the built-in fixture already calls for you - use it directly
only if you want to capture manually instead of relying on the fixture, e.g. inside a script that
isn't a Playwright test.)

## `$batch`, unpacked

This is the part a generic network logger can't do, and the reason a naive version of this feature
would be nearly useless against a real Fiori app: `sap.ui.model.odata.v2.ODataModel` defaults to
`useBatch: true`, so an app's actual business calls (`GET Products`, `POST Orders`, ...) never
appear as their own HTTP request at all - they're multipart parts buried inside one opaque
`POST .../$batch`. A catalog that only recorded the outer `$batch` call would tell you nothing
useful.

This parses the real, spec-documented multipart format - the exact inverse of what
[`mockODataBatch`](odata-mocking.md#mocking-batch-what-real-fiori-apps-actually-send) builds - and
pulls each embedded request/response back out as its own catalog entry, labeled `(via $batch)` so
you can still see how it was actually transported.

## Grouping: one entry per endpoint, not per call

`Products('HT-1000')`, `Products('HT-1001')`, `Products('HT-1002')`... all collapse into one
`Products(...)` catalog entry, with a call count and one representative sample - a real run
against a list report can call the same detail endpoint dozens of times with different keys, and
nobody wants dozens of near-identical entries. OData key predicates are what's collapsed
specifically; the rest of the path is left alone.

## Options

```ts
reporter: [
  ['list'],
  [
    'playwright-sapui5/reporter/api-catalog',
    { outputFile: 'docs/api-catalog.md', jsonOutputFile: 'api-catalog.json', title: 'My App API Catalog' },
  ],
],
```

| Option           | Default            | What it does                                              |
| ---------------- | ------------------ | --------------------------------------------------------- |
| `outputFile`     | `'api-catalog.md'` | Where to write the Markdown catalog                       |
| `jsonOutputFile` | -                  | Also write the raw, grouped entries as JSON, at this path |
| `title`          | `'API Catalog'`    | Heading of the generated document                         |

## <a id="overhead"></a>Overhead, and how to turn it off

The capture fixture runs for **every** test automatically, the same "no opt-in needed" design as
this package's other auto-fixtures. The cost is small and bounded on purpose: the filter runs on
response _headers_ alone, before any body is read - only genuinely matching (typically business
API) responses cost anything at all, not every request a browser makes. Still, it's not literally
free, and it adds a `ui5-api-calls.json` attachment to any test whose traffic matched anything -
visible in the HTML report whether or not you've registered the reporter.

If you'd rather it stayed fully inert unless you're actually generating a catalog, build your own
`test` that overrides the fixture with a no-op:

```ts
// my-test.ts
import { test as base } from 'playwright-sapui5';
export const test = base.extend({ ui5ApiCatalog: async ({}, use) => use() });
```

## Verified

Against the real, live Shopping Cart demo this framework's other examples use: `startApiCapture`
correctly records the app's real mock-data JSON responses while excluding `manifest.json`/
`sap-ui-version.json`/framework resources, and the resulting catalog builds and renders correctly.
`$batch` parsing is verified against two genuinely real formats: the request body captured from an
actual `sap.ui.model.odata.v2.ODataModel` with `useBatch: true`, and the response body built by
this package's own `mockODataBatch`. See
[`examples/tests/api-catalog.spec.ts`](../examples/tests/api-catalog.spec.ts).

## Related

- [docs/odata-mocking.md](odata-mocking.md) - `mockODataBatch`, the multipart builder this parses
  the inverse of
- [docs/jira.md](jira.md), [docs/locator-health.md](locator-health.md) - the other reporters built
  on the same fixture-attaches, reporter-aggregates pattern
