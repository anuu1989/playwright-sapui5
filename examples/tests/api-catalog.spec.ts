import { test, expect } from '../../src';
import {
  buildApiCatalog,
  defaultApiCallFilter,
  expandBatchCall,
  normalizeEndpointPath,
  parseBatchRequestParts,
  parseBatchResponseParts,
  renderApiCatalogMarkdown,
  startApiCapture,
} from '../../src';
import type { CapturedApiCall } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Covers the API catalog feature - see docs/api-catalog.md.
 *
 * Most of this is pure-logic (grouping, rendering, `$batch` parsing), the same reasoning
 * `jira.spec.ts`/`health.spec.ts` test their reporters' logic directly: no browser needed to
 * exercise those edge cases, and it's faster and more precise than only ever testing through a
 * real page. One test at the bottom drives the real, live Shopping Cart demo end to end, to prove
 * the capture mechanism itself (not just the logic downstream of it) actually works.
 */
test.describe('API catalog: grouping and rendering', () => {
  const call = (overrides: Partial<CapturedApiCall>): CapturedApiCall => ({
    method: 'GET',
    url: 'https://example.com/svc/Products',
    status: 200,
    requestHeaders: {},
    requestBody: undefined,
    responseHeaders: {},
    responseBody: undefined,
    contentType: 'application/json',
    ...overrides,
  });

  test('normalizeEndpointPath collapses OData keys and drops the query string', async () => {
    expect(normalizeEndpointPath("/svc/Products('HT-1000')")).toBe('/svc/Products(...)');
    expect(normalizeEndpointPath('/svc/Products(1)')).toBe('/svc/Products(...)');
    expect(normalizeEndpointPath('/svc/Products?$top=10&$skip=20')).toBe('/svc/Products');
    expect(normalizeEndpointPath('/svc/Products')).toBe('/svc/Products');
  });

  test('buildApiCatalog groups different keys of the same endpoint into one entry', async () => {
    const entries = buildApiCatalog([
      call({ url: "https://example.com/svc/Products('HT-1000')" }),
      call({ url: "https://example.com/svc/Products('HT-1001')" }),
      call({ method: 'POST', url: 'https://example.com/svc/Orders' }),
    ]);

    expect(entries).toHaveLength(2);
    const products = entries.find((e) => e.endpoint === '/svc/Products(...)')!;
    expect(products.count).toBe(2);
    expect(products.method).toBe('GET');
    const orders = entries.find((e) => e.endpoint === '/svc/Orders')!;
    expect(orders.count).toBe(1);
  });

  test('buildApiCatalog prefers a call with a real response body as the sample', async () => {
    const entries = buildApiCatalog([
      call({ responseBody: undefined }),
      call({ responseBody: '{"ProductID":"1"}' }),
    ]);
    expect(entries[0].sample.responseBody).toBe('{"ProductID":"1"}');
  });

  test('buildApiCatalog keeps direct and $batch-routed calls to the same endpoint separate', async () => {
    const entries = buildApiCatalog([
      call({ url: 'https://example.com/svc/Products' }),
      call({ url: 'https://example.com/svc/$batch', batchPath: 'Products' }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.viaBatch)).toHaveLength(1);
  });

  test('renderApiCatalogMarkdown pretty-prints JSON and fences XML correctly, not as JSON', async () => {
    const markdown = renderApiCatalogMarkdown(
      buildApiCatalog([
        call({ responseBody: '{"a":1}' }),
        call({
          url: 'https://example.com/svc/$metadata',
          contentType: 'application/xml',
          responseBody: '<?xml version="1.0"?><Edmx/>',
        }),
      ]),
    );
    expect(markdown).toContain('```json\n{\n  "a": 1\n}\n```');
    expect(markdown).toContain('```xml\n<?xml version="1.0"?><Edmx/>\n```');
  });
});

test.describe('API catalog: $batch parsing', () => {
  // Exact real formats - the request body captured from a genuine sap.ui.model.odata.v2.ODataModel
  // (useBatch: true), the response body built by this same package's own mockODataBatch. See
  // docs/api-catalog.md for how these were verified.
  const REAL_REQUEST_BODY = [
    '',
    '--batch_1599-1a2b-1461',
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    'GET Products HTTP/1.1',
    'Accept: application/json',
    'DataServiceVersion: 2.0',
    '',
    '',
    '--batch_1599-1a2b-1461--',
    '',
  ].join('\r\n');

  const REAL_RESPONSE_BODY = [
    '--batchresponse_abc123',
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    'HTTP/1.1 200 OK',
    'Content-Type: application/json',
    '',
    JSON.stringify({ d: { results: [{ ProductID: '1', Name: 'Widget' }] } }),
    '',
    '--batchresponse_abc123--',
    '',
  ].join('\r\n');

  test('parses the embedded request out of a real $batch request body', async () => {
    const parts = parseBatchRequestParts(
      REAL_REQUEST_BODY,
      'multipart/mixed;boundary=batch_1599-1a2b-1461',
    );
    expect(parts).toEqual([
      {
        method: 'GET',
        path: 'Products',
        headers: { accept: 'application/json', dataserviceversion: '2.0' },
      },
    ]);
  });

  test('parses the embedded response out of a real $batch response body', async () => {
    const parts = parseBatchResponseParts(
      REAL_RESPONSE_BODY,
      'multipart/mixed; boundary=batchresponse_abc123',
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].status).toBe(200);
    expect(JSON.parse(parts[0].body)).toEqual({
      d: { results: [{ ProductID: '1', Name: 'Widget' }] },
    });
  });

  test('expandBatchCall pairs request and response parts positionally into real catalog entries', async () => {
    const expanded = expandBatchCall({
      method: 'POST',
      url: 'https://example.com/svc/$batch',
      status: 202,
      requestHeaders: { 'content-type': 'multipart/mixed;boundary=batch_1599-1a2b-1461' },
      requestBody: REAL_REQUEST_BODY,
      responseHeaders: { 'content-type': 'multipart/mixed; boundary=batchresponse_abc123' },
      responseBody: REAL_RESPONSE_BODY,
      contentType: 'multipart/mixed; boundary=batchresponse_abc123',
    });
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({ method: 'GET', batchPath: 'Products', status: 200 });
    expect(JSON.parse(expanded[0].responseBody!)).toEqual({
      d: { results: [{ ProductID: '1', Name: 'Widget' }] },
    });
  });
});

test.describe('API catalog: default filter', () => {
  test('excludes known SAPUI5 framework resources, includes business-shaped JSON/XML', async () => {
    expect(
      defaultApiCallFilter({
        url: 'https://x/resources/sap/m/Button.js',
        contentType: 'text/javascript',
      }),
    ).toBe(false);
    expect(
      defaultApiCallFilter({
        url: 'https://x/webapp/manifest.json',
        contentType: 'application/json',
      }),
    ).toBe(false);
    expect(
      defaultApiCallFilter({ url: 'https://x/i18n/i18n.properties', contentType: 'text/plain' }),
    ).toBe(false);
    expect(
      defaultApiCallFilter({
        url: 'https://x/webapp/view/Main.view.xml',
        contentType: 'application/xml',
      }),
    ).toBe(false);

    expect(
      defaultApiCallFilter({ url: 'https://x/svc/Products', contentType: 'application/json' }),
    ).toBe(true);
    expect(
      defaultApiCallFilter({ url: 'https://x/svc/$metadata', contentType: 'application/xml' }),
    ).toBe(true);
  });
});

/**
 * Drives the real, live Shopping Cart demo end to end - proving the capture mechanism itself
 * (network listener, header-based filtering, body reading) actually works against a real app, not
 * just the pure logic downstream of it.
 */
test('startApiCapture records real traffic from the live Cart demo, filtered to business data', async ({
  page,
}) => {
  const capture = startApiCapture(page);

  const cart = new CartPage(page);
  await cart.open();
  await cart.selectCategory('Laptops');

  await expect.poll(() => capture.calls.length).toBeGreaterThan(0);

  const urls = capture.calls.map((c) => c.url);
  // The app's real mock-data files - genuine business responses.
  expect(urls.some((u) => u.includes('mockdata/Products.json'))).toBe(true);
  expect(urls.some((u) => u.includes('mockdata/ProductCategories.json'))).toBe(true);
  // Framework noise the default filter is supposed to keep out.
  expect(urls.some((u) => u.includes('manifest.json'))).toBe(false);
  expect(urls.some((u) => u.includes('sap-ui-version.json'))).toBe(false);

  const productsCall = capture.calls.find((c) => c.url.includes('mockdata/Products.json'))!;
  expect(productsCall.status).toBe(200);
  expect(() => JSON.parse(productsCall.responseBody!)).not.toThrow();

  const entries = buildApiCatalog(capture.calls);
  expect(entries.length).toBeGreaterThan(0);
  const markdown = renderApiCatalogMarkdown(entries, { title: 'Cart demo' });
  expect(markdown).toContain('# Cart demo');
});
