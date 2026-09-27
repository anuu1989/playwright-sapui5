/**
 * A small, direct Jira REST client - no SDK, no middleman. See docs/jira.md.
 *
 * It covers exactly the three calls the reporter needs (comment, create issue, attach file) and
 * nothing else, because a general-purpose Jira SDK is a large dependency to take on for that.
 *
 * The two Jira flavours differ in ways that bite immediately, so both are handled here rather
 * than left to the caller:
 *
 * | | Jira **Cloud** | Jira **Server / Data Center** |
 * | --- | --- | --- |
 * | REST path | `/rest/api/3` | `/rest/api/2` |
 * | Auth | Basic, `email:apiToken` | Bearer, a personal access token |
 * | Comment body | ADF, a nested JSON document | a plain wiki-markup string |
 *
 * That last row is the one that silently fails: posting a plain string to Cloud's v3 endpoint is
 * rejected, and posting ADF to a Server instance stores a JSON blob as the visible comment text.
 */

export type JiraDeployment = 'cloud' | 'server';

export interface JiraClientOptions {
  /** e.g. `https://your-org.atlassian.net` (Cloud) or `https://jira.your-company.com` (Server). */
  baseUrl: string;
  deployment?: JiraDeployment;
  /** Cloud: the account email, paired with `apiToken`. */
  email?: string;
  /** Cloud: an API token from id.atlassian.com. */
  apiToken?: string;
  /** Server/DC: a personal access token, used as a bearer token. */
  personalAccessToken?: string;
  /** Log what would be sent instead of sending it. Nothing reaches Jira. */
  dryRun?: boolean;
  /** Per-request timeout. */
  timeoutMs?: number;
}

export interface JiraRequestLogEntry {
  method: string;
  path: string;
  body?: unknown;
}

/** Reads client options from the conventional environment variables, so credentials live in the
 * environment rather than in a committed config file. Returns `undefined` when there isn't enough
 * to authenticate - the reporter treats that as "Jira not configured" and skips, rather than
 * failing a test run over reporting. */
export function jiraOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): JiraClientOptions | undefined {
  const baseUrl = env.JIRA_BASE_URL;
  if (!baseUrl) return undefined;

  const personalAccessToken = env.JIRA_PAT ?? env.JIRA_PERSONAL_ACCESS_TOKEN;
  const email = env.JIRA_EMAIL;
  const apiToken = env.JIRA_API_TOKEN;

  if (!personalAccessToken && !(email && apiToken)) return undefined;

  return {
    baseUrl,
    // A PAT means Server/DC; an email+token pair means Cloud. `JIRA_DEPLOYMENT` overrides when
    // an instance doesn't follow that pattern.
    deployment:
      (env.JIRA_DEPLOYMENT as JiraDeployment) ?? (personalAccessToken ? 'server' : 'cloud'),
    email,
    apiToken,
    personalAccessToken,
  };
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly deployment: JiraDeployment;
  private readonly dryRun: boolean;
  private readonly timeoutMs: number;
  private readonly authHeader: string;

  /** Everything that was sent (or, in dry-run, would have been). Exposed so a test can assert on
   * the exact requests without a Jira to point at. */
  readonly requestLog: JiraRequestLogEntry[] = [];

  constructor(options: JiraClientOptions) {
    // Trailing slashes are the classic copy-paste error here and produce `//rest/api/3/...`,
    // which some proxies happily 404 on.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.deployment = options.deployment ?? 'cloud';
    this.dryRun = options.dryRun ?? false;
    this.timeoutMs = options.timeoutMs ?? 15000;

    if (options.personalAccessToken) {
      this.authHeader = `Bearer ${options.personalAccessToken}`;
    } else if (options.email && options.apiToken) {
      this.authHeader = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString('base64')}`;
    } else {
      throw new Error(
        '[playwright-sapui5] JiraClient: provide either personalAccessToken (Server/DC) or email + apiToken (Cloud).',
      );
    }
  }

  private get apiPath(): string {
    return this.deployment === 'cloud' ? '/rest/api/3' : '/rest/api/2';
  }

  /**
   * Adds a comment to an issue, formatting the body for whichever Jira this is - ADF for Cloud, a
   * wiki-markup string for Server/DC.
   */
  async addComment(issueKey: string, text: string): Promise<void> {
    const body = this.deployment === 'cloud' ? { body: toAtlassianDocument(text) } : { body: text };
    await this.request(
      'POST',
      `${this.apiPath}/issue/${encodeURIComponent(issueKey)}/comment`,
      body,
    );
  }

  /**
   * Creates an issue and returns its key (`undefined` in dry-run, where nothing was created).
   *
   * `fields` is passed through as-is beyond the basics, because required fields vary so much
   * between projects - many Jira projects make components, versions or a custom field mandatory,
   * and guessing at those would just produce failed creates.
   */
  async createIssue(input: {
    projectKey: string;
    summary: string;
    description: string;
    issueType: string;
    fields?: Record<string, unknown>;
  }): Promise<string | undefined> {
    const body = {
      fields: {
        project: { key: input.projectKey },
        summary: input.summary,
        issuetype: { name: input.issueType },
        description:
          this.deployment === 'cloud' ? toAtlassianDocument(input.description) : input.description,
        ...input.fields,
      },
    };
    const response = await this.request('POST', `${this.apiPath}/issue`, body);
    return (response as { key?: string } | undefined)?.key;
  }

  /** Attaches a file to an issue - used for the UI5 control-tree dump, which is the single most
   * useful thing to have on a Jira bug raised from a failing UI5 test. */
  async addAttachment(issueKey: string, fileName: string, content: string): Promise<void> {
    const path = `${this.apiPath}/issue/${encodeURIComponent(issueKey)}/attachments`;
    if (this.dryRun) {
      this.requestLog.push({ method: 'POST', path, body: { fileName, bytes: content.length } });
      return;
    }

    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain' }), fileName);
    this.requestLog.push({ method: 'POST', path, body: { fileName, bytes: content.length } });

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        // Jira rejects attachment uploads without this header - it's a deliberate XSRF guard, and
        // omitting it produces a confusing 403 rather than anything mentioning the header.
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `[playwright-sapui5] Jira attachment upload failed: ${response.status} ${await safeText(response)}`,
      );
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    this.requestLog.push({ method, path, body });
    if (this.dryRun) return undefined;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `[playwright-sapui5] Jira ${method} ${path} failed: ${response.status} ${await safeText(response)}`,
      );
    }
    // Some endpoints (a 204 on certain instances) return no body at all.
    const text = await safeText(response);
    return text ? JSON.parse(text) : undefined;
  }
}

/**
 * Wraps plain text in the minimal Atlassian Document Format envelope Jira Cloud requires: a `doc`
 * containing one `paragraph` per line. Blank lines become empty paragraphs rather than being
 * dropped, so the formatting of a multi-line summary survives.
 */
export function toAtlassianDocument(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      // ADF rejects a text node with an empty string, so an empty line becomes an empty paragraph.
      content: line.length > 0 ? [{ type: 'text', text: line }] : [],
    })),
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
