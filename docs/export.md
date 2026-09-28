# `Ui5Export` (capturing a spreadsheet download)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

A real Fiori list report commonly has an "Export to Spreadsheet" (or "Export to Excel") button -
`sap.ui.mdc.Table` (Fiori Elements for OData V4) and `sap.ui.comp.smarttable.SmartTable` (OData
V2) both ship one by default, rendered with the icon `sap-icon://excel-attachment`. Clicking it
triggers a real browser file download. `Ui5Export.captureDownload()` catches that download
correctly and hands you the file's raw bytes.

```ts
import { Ui5Export } from 'playwright-sapui5';

const file = await Ui5Export.captureDownload(page, () =>
  ui5(page).id('export-internalSplitBtn-textButton').click(),
);
expect(file.looksLikeXlsx).toBe(true);
```

## The trap this avoids

`page.waitForEvent('download')` has to be **registered before** the click that triggers the
download, or the event can fire and be missed entirely - a well-known Playwright gotcha. Writing
that correctly every time means remembering `Promise.all([page.waitForEvent('download'), trigger()])`
in every test that needs it. `captureDownload()` takes the triggering action as a callback
specifically so it can register the listener first, every time, without you having to think about
the ordering.

## Finding the trigger

`captureDownload()` deliberately doesn't try to locate the export button itself - which control it
is varies by app, and this framework's own [`ui5()`](locators.md) already covers finding it. Two
real, observed conventions worth knowing:

- **`sap.ui.mdc.Table`** (Fiori Elements V4): the button's id always ends in
  `-export-internalSplitBtn-textButton` (the icon half of a split button; the arrow half opens a
  menu of format options). Verified against the SAPUI5 SDK's own live FPM Explorer sample.
- **Either table family**: the icon is `sap-icon://excel-attachment` - `ui5(page).controlType('sap.m.Button', { icon: 'sap-icon://excel-attachment' })`
  finds it without knowing the exact id.

## What `looksLikeXlsx` actually checks

```ts
interface Ui5DownloadResult {
  suggestedFilename: string;
  buffer: Buffer;
  byteLength: number;
  looksLikeXlsx: boolean;
}
```

**Only a magic-byte check** - `buffer` starting with a ZIP local-file-header signature
(`PK\x03\x04`, or the empty-archive form `PK\x05\x06`). It does not open the archive, and it can't
tell an XLSX apart from any other ZIP-based format. It's named for the practical case a test
actually has: SAPUI5's own `sap.ui.export.Spreadsheet` (what a real export button triggers)
produces a genuine XLSX - a ZIP archive - by default, so this answers the question that matters:
"did a real spreadsheet file come back, not an HTML error page or an empty response" - not "prove
this is exactly an XLSX." If you need to assert on the spreadsheet's actual cell contents, that
needs a real XLSX-parsing library (e.g. `exceljs`) reading `file.buffer` yourself - deliberately
out of scope here, the same way this framework doesn't ship its own EDMX or `$batch`
implementations replacing a real library where one exists and the job is standard.

## A failed or canceled download throws, with a clear message

```ts
await Ui5Export.captureDownload(page, () => trigger()); // throws if the download never completed
```

Playwright's own `download.path()` **rejects** (it doesn't resolve to `null`, despite what its own
type signature might suggest) when a download failed or was canceled partway through - verified
directly against a connection that's deliberately killed mid-download, not assumed from Playwright's
docs. `captureDownload()` catches that and throws its own clear error instead, with
`download.failure()`'s reason included when one's available.

## Works through an iframe

```ts
const frame = await findUi5Frame(page);
const file = await Ui5Export.captureDownload(frame, () => ui5(frame).id('export...').click());
```

Playwright's `download` event is a `Page`-level event even when the click that triggers it happens
inside a child `Frame` - `captureDownload()` resolves the owning `Page` for you (`frame.page()`)
either way, so passing a `Frame` (the way a real `sap.fe` app - rendered inside an iframe, see
[docs/mdc-table.md](mdc-table.md) - needs) works exactly like passing a `Page`.

## API

```ts
class Ui5Export {
  static captureDownload(
    target: Page | Frame,
    trigger: () => Promise<void>,
    options?: { timeout?: number },
  ): Promise<Ui5DownloadResult>;
}
```

## Verified

**Real downloads, real local server; the live-app trigger click confirmed separately.** The
download race, byte-reading, the ZIP-signature check (both a real ZIP-signature file and a plain
CSV that correctly reads `false`), the iframe-routed case, and the failed/canceled-download error
path are all verified against a real local HTTP server serving genuine
`Content-Disposition: attachment` responses - see
[`examples/tests/export.spec.ts`](../examples/tests/export.spec.ts). Separately, the trigger side

- finding and clicking a real `sap.ui.mdc.Table` export button by its documented id convention -
  is confirmed against the SAPUI5 SDK's own live `sap.fe` FPM Explorer sample; that sample's export
  itself couldn't be completed anonymously (its mock backend rejects the full-collection `$batch`
  read the export needs), so this feature's _end-to-end_ live-app behavior - a genuine file
  completing a download - is not independently proven, the same category of gap
  [docs/odata-client.md](odata-client.md) documents for its own CSRF handshake.

## Related

- [docs/mdc-table.md](mdc-table.md) - `Ui5MdcTable`, for reading the table this export button
  belongs to
- [docs/cross-frame.md](cross-frame.md) - working against a `Frame`, the way a real `sap.fe` app
  needs
