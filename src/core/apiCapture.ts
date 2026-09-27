import type { Page } from '@playwright/test';

/**
 * Recording the real API traffic a SAPUI5 app makes while a test drives it - the raw material
 * `ApiCatalogReporter` (see `src/integrations/ApiCatalogReporter.ts`) turns into a catalog. See
 * docs/api-catalog.md.
 *
 * The one thing this has to get right that a generic network logger wouldn't: OData V2's
 * `$batch`. `sap.ui.model.odata.v2.ODataModel` defaults to `useBatch: true`, so a real Fiori app's
 * actual business calls (`GET Products`, `POST Orders`, ...) never appear as their own HTTP
 * requests at all - they're multipart parts buried inside one opaque `POST .../$batch`. A catalog
 * that only recorded the outer `$batch` call would be useless; this parses the real,
 * spec-documented multipart format (the exact inverse of what `odataMock.ts`'s `mockODataBatch`
 * builds) to pull each embedded request/response back out as its own catalog entry.
 */

export interface CapturedApiCall {
  method: string;
  /** The full URL this call was made to. For a call extracted from inside a `$batch`, this is the
   * `$batch` endpoint's own URL - see `batchPath` for the part that actually identifies it. */
  url: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestBody: string | undefined;
  responseHeaders: Record<string, string>;
  responseBody: string | undefined;
  contentType: string | undefined;
  /** Set only for a call extracted from inside a `$batch` request - the embedded request's own
   * path (e.g. `"Products('1')"`), exactly as the batch body specified it (relative, per the
   * OData V2 spec - not resolved against `url` above, which would risk inventing a wrong one). */
  batchPath?: string;
}

export interface ApiCaptureOptions {
  /** Return `true` to capture this response. Defaults to `defaultApiCallFilter` - JSON/XML/
   * multipart responses, minus well-known SAPUI5 framework resource requests. */
  filter?: (info: { url: string; contentType: string | undefined }) => boolean;
}

/** URL patterns that are SAPUI5's own framework traffic, not the app's business API - excluded by
 * `defaultApiCallFilter` so a catalog isn't drowned in view/fragment/i18n/library noise. This is a
 * heuristic, not a guarantee: pass your own `filter` if your app's real API happens to match one
 * of these, or if you want framework traffic included too. */
const FRAMEWORK_NOISE_PATTERNS: RegExp[] = [
  /\/resources\/sap\//, // SAPUI5's own library resources
  /\bsap-ui-version\.json\b/,
  /\bmanifest\.json\b/,
  /\.view\.xml\b/,
  /\.fragment\.xml\b/,
  /\bi18n[\w.-]*\.properties\b/,
  /\bmessagebundle[\w.-]*\.properties\b/,
  /\/cldr\//,
  /\billustrations\/[\w.-]+\.(?:json|svg)\b/i,
];

const CONTENT_TYPE_INCLUDE = /\b(?:json|xml|multipart)\b/i;

/** Captures a response whose content type looks like data (JSON/XML/multipart) and whose URL
 * doesn't match a known SAPUI5 framework resource pattern. */
export function defaultApiCallFilter(info: {
  url: string;
  contentType: string | undefined;
}): boolean {
  if (!CONTENT_TYPE_INCLUDE.test(info.contentType ?? '')) return false;
  return !FRAMEWORK_NOISE_PATTERNS.some((pattern) => pattern.test(info.url));
}

/**
 * Starts recording `page`'s network traffic. Call this **before navigating** (the same rule as
 * installing this framework's own bridge - see docs/auto-wait.md) to catch calls made during
 * bootstrap too. Returns a live object whose `calls` array grows as matching responses arrive -
 * read it any time, including mid-test.
 *
 * ```ts
 * const capture = startApiCapture(page);
 * await page.goto(APP_URL);
 * // ... drive the app ...
 * console.log(capture.calls);
 * ```
 */
export function startApiCapture(
  page: Page,
  options: ApiCaptureOptions = {},
): { calls: CapturedApiCall[] } {
  const filter = options.filter ?? defaultApiCallFilter;
  const state: { calls: CapturedApiCall[] } = { calls: [] };

  page.on('response', (response) => {
    // Fire-and-forget: a response listener can't be awaited by whatever emitted the event, and a
    // slow or failing capture must never hold up or break the test it's observing.
    void (async () => {
      try {
        const contentType = response.headers()['content-type'];
        if (!filter({ url: response.url(), contentType })) return;

        const request = response.request();
        const [requestHeaders, responseBody] = await Promise.all([
          request.allHeaders(),
          response.text().catch(() => undefined),
        ]);

        const call: CapturedApiCall = {
          method: request.method(),
          url: response.url(),
          status: response.status(),
          requestHeaders,
          requestBody: request.postData() ?? undefined,
          responseHeaders: response.headers(),
          responseBody,
          contentType,
        };

        if (isBatchCall(call)) {
          state.calls.push(...expandBatchCall(call));
        } else {
          state.calls.push(call);
        }
      } catch {
        // A capture failure (a torn-down page mid-navigation, a malformed body) must never
        // surface as a test failure - this is an observer, not part of the app under test.
      }
    })();
  });

  return state;
}

function isBatchCall(call: CapturedApiCall): boolean {
  return call.method === 'POST' && /\$batch(?:[/?]|$)/i.test(call.url) && !!call.requestBody;
}

/** Pulls the `boundary=...` value out of a `multipart/...` Content-Type header - present with or
 * without a space after the `;`, and with or without quotes, both seen in real traffic. */
function extractBoundary(contentType: string | undefined): string | undefined {
  const match = /boundary=("?)([^;"\s]+)\1/i.exec(contentType ?? '');
  return match?.[2];
}

/** Splits a multipart body on its boundary marker, dropping the preamble before the first part
 * and the closing `--boundary--` delimiter's own leftover fragment - so every element returned is
 * one real part's raw text (its own `Content-Type: application/http` header through to its
 * embedded HTTP message). */
function splitMultipartParts(body: string, boundary: string): string[] {
  return body
    .split(`--${boundary}`)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !/^-+$/.test(segment));
}

/** Parses one part's `Header: value` lines up to the first blank line, returning the headers
 * (lowercased keys) and everything after that blank line. Used twice per part - once to skip the
 * `Content-Type: application/http` wrapper, once more for the embedded HTTP message's own
 * headers. */
function splitHeaderBlock(text: string): { headers: Record<string, string>; rest: string } {
  const lines = text.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { headers, rest: lines.slice(i + 1).join('\n') };
}

/** One embedded request pulled out of a `$batch` **request** body. */
interface BatchRequestPart {
  method: string;
  path: string;
  headers: Record<string, string>;
}

/** Parses a `$batch` request body's embedded requests - `GET Products HTTP/1.1`, headers, and (for
 * a write) a body. Exported for direct testing - see examples/tests/api-catalog.spec.ts. */
export function parseBatchRequestParts(
  body: string,
  contentType: string | undefined,
): BatchRequestPart[] {
  const boundary = extractBoundary(contentType);
  if (!boundary) return [];
  return splitMultipartParts(body, boundary).map((partText) => {
    const { rest: httpMessage } = splitHeaderBlock(partText); // skip "Content-Type: application/http"
    const lines = httpMessage.split(/\r?\n/);
    const requestLineMatch = /^(\w+)\s+(\S+)\s+HTTP\/[\d.]+$/i.exec((lines[0] ?? '').trim());
    const { headers } = splitHeaderBlock(lines.slice(1).join('\n'));
    return {
      method: requestLineMatch?.[1]?.toUpperCase() ?? 'GET',
      path: requestLineMatch?.[2] ?? '',
      headers,
    };
  });
}

/** One embedded response pulled out of a `$batch` **response** body. */
interface BatchResponsePart {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Parses a `$batch` response body's embedded responses - `HTTP/1.1 200 OK`, headers, and the JSON
 * body. Exported for direct testing - see examples/tests/api-catalog.spec.ts. */
export function parseBatchResponseParts(
  body: string,
  contentType: string | undefined,
): BatchResponsePart[] {
  const boundary = extractBoundary(contentType);
  if (!boundary) return [];
  return splitMultipartParts(body, boundary).map((partText) => {
    const { rest: httpMessage } = splitHeaderBlock(partText); // skip "Content-Type: application/http"
    const lines = httpMessage.split(/\r?\n/);
    const statusLineMatch = /^HTTP\/[\d.]+\s+(\d+)/i.exec((lines[0] ?? '').trim());
    const { headers, rest } = splitHeaderBlock(lines.slice(1).join('\n'));
    return {
      status: statusLineMatch ? Number(statusLineMatch[1]) : 0,
      headers,
      body: rest.trim(),
    };
  });
}

/** Expands one captured `$batch` call into its embedded requests, matched positionally to their
 * responses (the same convention `mockODataBatch` documents - the first embedded request answers
 * to the first embedded response, in order). A request/response with no counterpart (a malformed
 * or partial batch) is skipped rather than guessed at. */
export function expandBatchCall(call: CapturedApiCall): CapturedApiCall[] {
  const requestParts = parseBatchRequestParts(
    call.requestBody ?? '',
    call.requestHeaders['content-type'],
  );
  const responseParts = parseBatchResponseParts(
    call.responseBody ?? '',
    call.responseHeaders['content-type'],
  );

  const count = Math.min(requestParts.length, responseParts.length);
  const expanded: CapturedApiCall[] = [];
  for (let i = 0; i < count; i++) {
    const request = requestParts[i];
    const response = responseParts[i];
    expanded.push({
      method: request.method,
      url: call.url,
      status: response.status,
      requestHeaders: request.headers,
      requestBody: undefined, // OData V2 batch reads/writes rarely carry a body worth separating here
      responseHeaders: response.headers,
      responseBody: response.body || undefined,
      contentType: response.headers['content-type'],
      batchPath: request.path,
    });
  }
  return expanded;
}
