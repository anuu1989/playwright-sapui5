import { createServer, type Server } from 'node:http';
import { test, expect } from '../../src';
import { Ui5Export } from '../../src';

/**
 * Verifies `Ui5Export.captureDownload` against a real local HTTP server that serves genuine
 * `Content-Disposition: attachment` downloads - real browser download events, not a mock of
 * Playwright's own `Download` API. See docs/export.md.
 *
 * Why local, not a real Fiori app: a real `sap.ui.mdc.Table`'s "Export to Spreadsheet" button
 * (icon `sap-icon://excel-attachment`) was found and clicked on the SAPUI5 SDK's own live
 * `sap.fe` FPM Explorer sample - confirming the trigger side of this genuinely works against a
 * real app - but that sample's export needs a full-collection `$batch` read from its mock
 * backend, which SAP's own demo infrastructure rejects for anonymous callers ("Access Denied").
 * No live, public, anonymously-accessible app with a *completable* spreadsheet export was
 * available - the same category of limitation documented for `Ui5ODataClient`
 * ([docs/odata-client.md](../../docs/odata-client.md)). What's verified here instead is the part
 * that's actually this helper's own logic: the download race, reading the file back as bytes,
 * the ZIP-signature check, and working through an iframe (a real `sap.fe` app's own shell,
 * per [`mdc-table.spec.ts`](mdc-table.spec.ts)).
 */
let server: Server;
let baseUrl: string;

test.beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url === '/xlsx') {
      const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats',
        'content-disposition': 'attachment; filename="export.xlsx"',
      });
      res.end(zipBytes);
      return;
    }
    if (req.url === '/csv') {
      res.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="export.csv"',
      });
      res.end('a,b,c\n1,2,3\n');
      return;
    }
    if (req.url === '/broken') {
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats',
        'content-disposition': 'attachment; filename="broken.xlsx"',
        'content-length': '1000000',
      });
      res.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      setTimeout(() => req.socket.destroy(), 50);
      return;
    }
    if (req.url === '/frame') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<a id="xlsx" href="/xlsx" download>xlsx in frame</a>`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<a id="xlsx" href="/xlsx" download>xlsx</a>` +
        `<a id="csv" href="/csv" download>csv</a>` +
        `<a id="broken" href="/broken" download>broken</a>` +
        `<iframe id="frame" src="/frame"></iframe>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('captures a real download with ZIP magic bytes -> looksLikeXlsx true', async ({ page }) => {
  await page.goto(baseUrl);
  const file = await Ui5Export.captureDownload(page, () => page.locator('#xlsx').click());
  expect(file.suggestedFilename).toBe('export.xlsx');
  expect(file.looksLikeXlsx).toBe(true);
  expect(file.byteLength).toBe(9);
});

test('a plain CSV download -> looksLikeXlsx false', async ({ page }) => {
  await page.goto(baseUrl);
  const file = await Ui5Export.captureDownload(page, () => page.locator('#csv').click());
  expect(file.suggestedFilename).toBe('export.csv');
  expect(file.looksLikeXlsx).toBe(false);
  expect(file.buffer.toString('utf-8')).toBe('a,b,c\n1,2,3\n');
});

test('works when the trigger click happens inside an iframe', async ({ page }) => {
  await page.goto(baseUrl);
  const frame = page.frameLocator('#frame');
  const file = await Ui5Export.captureDownload(page.frame({ url: /\/frame$/ })!, () =>
    frame.locator('#xlsx').click(),
  );
  expect(file.looksLikeXlsx).toBe(true);
});

test('a download that never completes throws a clear error', async ({ page }) => {
  await page.goto(baseUrl);
  await expect(
    Ui5Export.captureDownload(page, () => page.locator('#broken').click()),
  ).rejects.toThrow(/never produced a local file/);
});
