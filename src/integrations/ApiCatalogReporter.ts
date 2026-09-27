import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { writeFileSync } from 'node:fs';
import type { CapturedApiCall } from '../core/apiCapture';

/**
 * Turns the API traffic captured across a whole test run into a catalog document - every distinct
 * endpoint the app actually called, with a real sample request and response. See
 * docs/api-catalog.md.
 *
 * Built the same way [`JiraReporter`](jira.md)/[`HealthReporter`](../../docs/locator-health.md)
 * are: a fixture (`ui5ApiCatalog`, built into this package's `test`) captures each test's traffic
 * and attaches it as `ui5-api-calls.json`; this reporter reads that attachment back across every
 * test and writes the combined catalog once, in `onEnd`.
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [['list'], ['playwright-sapui5/reporter/api-catalog']],
 * ```
 *
 * The value here comes from reusing a **real, already-written test suite's real user journeys** -
 * whatever your tests actually click through, the catalog captures. A page-load-only crawler
 * would only ever see bootstrap traffic.
 */
export interface ApiCatalogReporterOptions {
  /** Where to write the markdown catalog. Default `'api-catalog.md'`. */
  outputFile?: string;
  /** Also write the raw, ungrouped catalog entries as JSON, at this path. Off by default. */
  jsonOutputFile?: string;
  /** Heading for the generated document. Default `'API Catalog'`. */
  title?: string;
}

export interface ApiCatalogEntry {
  method: string;
  /** The grouping key - method-independent normalized path, e.g. `"Products(...)"` for every
   * `Products('HT-1000')`/`Products('HT-1001')`/... call, so a real run's many detail reads
   * collapse into one catalog entry instead of one per key. */
  endpoint: string;
  /** How many captured calls matched this endpoint (across every test in the run). */
  count: number;
  /** Whether every call in this group was made directly, or came from inside a `$batch` request -
   * shown separately, since that's genuinely useful information for someone about to mock this
   * endpoint (see docs/odata-mocking.md). */
  viaBatch: boolean;
  /** One representative call - preferring one with a real response body over an empty one. */
  sample: CapturedApiCall;
}

/** Drops the query string and collapses OData key predicates (`Products('HT-1000')`,
 * `Products(1)`, `Products(guid'...')`) down to `Products(...)`, so calls to the same logical
 * endpoint with different keys group together instead of each getting their own catalog entry. */
export function normalizeEndpointPath(rawPath: string): string {
  const withoutQuery = rawPath.split('?')[0];
  return withoutQuery.replace(/\([^)]*\)/g, '(...)');
}

function rawPathFor(call: CapturedApiCall): string {
  if (call.batchPath !== undefined) return call.batchPath;
  try {
    const url = new URL(call.url);
    return url.pathname + url.search;
  } catch {
    return call.url;
  }
}

/** Groups captured calls into catalog entries - see `ApiCatalogEntry` for what each field means.
 * Pure and exported for direct testing, the same reasoning `summarizeHeals` in
 * `HealthReporter.ts` is. */
export function buildApiCatalog(calls: CapturedApiCall[]): ApiCatalogEntry[] {
  const groups = new Map<
    string,
    { method: string; endpoint: string; viaBatch: boolean; calls: CapturedApiCall[] }
  >();

  for (const call of calls) {
    const viaBatch = call.batchPath !== undefined;
    const endpoint = normalizeEndpointPath(rawPathFor(call));
    const key = `${call.method} ${endpoint} ${viaBatch}`;
    const group = groups.get(key) ?? { method: call.method, endpoint, viaBatch, calls: [] };
    group.calls.push(call);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    method: group.method,
    endpoint: group.endpoint,
    count: group.calls.length,
    viaBatch: group.viaBatch,
    // Prefer a call with a real response body as the representative sample - a more useful
    // example than one that happened to 204/304 first.
    sample: group.calls.find((call) => !!call.responseBody?.trim()) ?? group.calls[0],
  }));
}

/** Pretty-prints a body if it's JSON, and picks the matching code-fence language either way -
 * an OData `$metadata` response is real, valuable XML to show in a catalog, and fencing it as
 * `json` would be actively misleading. */
function formatBody(body: string | undefined): { lang: string; text: string } {
  if (!body?.trim()) return { lang: '', text: '(empty)' };
  try {
    return { lang: 'json', text: JSON.stringify(JSON.parse(body), null, 2) };
  } catch {
    const lang = /^\s*<[?a-z!]/i.test(body) ? 'xml' : '';
    return { lang, text: body };
  }
}

/** Renders catalog entries as a Markdown document - every endpoint, how many times it was called,
 * whether it went through `$batch`, and a sample request/response. Pure and exported for direct
 * testing. */
export function renderApiCatalogMarkdown(
  entries: ApiCatalogEntry[],
  options: { title?: string } = {},
): string {
  const title = options.title ?? 'API Catalog';
  const sorted = [...entries].sort(
    (a, b) => a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method),
  );

  const lines: string[] = [
    `# ${title}`,
    '',
    `${entries.length} distinct endpoint${entries.length === 1 ? '' : 's'} captured from real test traffic.`,
    '',
  ];

  for (const entry of sorted) {
    lines.push(
      `## ${entry.method} ${entry.endpoint}${entry.viaBatch ? ' _(via `$batch`)_' : ''}`,
      '',
      `Called ${entry.count} time${entry.count === 1 ? '' : 's'}.`,
      '',
    );
    if (entry.sample.requestBody?.trim()) {
      const { lang, text } = formatBody(entry.sample.requestBody);
      lines.push('**Sample request body:**', '', '```' + lang, text, '```', '');
    }
    const { lang, text } = formatBody(entry.sample.responseBody);
    lines.push(
      `**Sample response** (status ${entry.sample.status}):`,
      '',
      '```' + lang,
      text,
      '```',
      '',
    );
  }

  return lines.join('\n');
}

export default class ApiCatalogReporter implements Reporter {
  private readonly options: ApiCatalogReporterOptions;
  private readonly allCalls: CapturedApiCall[] = [];

  constructor(options: ApiCatalogReporterOptions = {}) {
    this.options = options;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((a) => a.name === 'ui5-api-calls.json');
    if (!attachment?.body) return;
    try {
      const calls: CapturedApiCall[] = JSON.parse(attachment.body.toString());
      this.allCalls.push(...calls);
    } catch {
      // A malformed attachment must never break the run's reporting - just skip it.
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
    if (this.allCalls.length === 0) return;

    const entries = buildApiCatalog(this.allCalls);
    const markdown = renderApiCatalogMarkdown(entries, { title: this.options.title });
    const outputFile = this.options.outputFile ?? 'api-catalog.md';
    writeFileSync(outputFile, markdown, 'utf-8');
    console.log(
      `[playwright-sapui5] API catalog: ${entries.length} endpoint(s) from ${this.allCalls.length} captured call(s) written to ${outputFile}`,
    );

    if (this.options.jsonOutputFile) {
      writeFileSync(this.options.jsonOutputFile, JSON.stringify(entries, null, 2), 'utf-8');
      console.log(
        `[playwright-sapui5] API catalog: JSON written to ${this.options.jsonOutputFile}`,
      );
    }
  }
}
