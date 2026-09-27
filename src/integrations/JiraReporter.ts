import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { JiraClient, jiraOptionsFromEnv, type JiraClientOptions } from './jiraClient';
import { issueKeysForTest } from './jiraIssueKeys';

export interface JiraReporterOptions extends Partial<JiraClientOptions> {
  /** Post a run summary as a comment on each referenced issue. Default `true`. */
  comment?: boolean;
  /** Also file a bug for each failing test. **Off by default** - see the note below. */
  createIssueOnFailure?: boolean;
  /** Project the bugs go into. Required when `createIssueOnFailure` is on. */
  projectKey?: string;
  /** Issue type for filed bugs. Default `'Bug'`. */
  issueType?: string;
  /** Extra fields merged into every created issue - components, versions, a mandatory custom
   * field. Projects differ wildly in what they require, so this is a passthrough. */
  issueFields?: Record<string, unknown>;
  /** Only report on failures, rather than on every result. Default `false`. */
  failuresOnly?: boolean;
  /**
   * Your real project keys, e.g. `['ABC', 'SAPUI5']`. **Strongly recommended.** A Jira key's
   * shape is indistinguishable from strings like `UTF-8` or `SHA-1`, so without this a test
   * titled "encoding is UTF-8" will try to comment on a `UTF-8` issue. Listing your projects
   * removes the ambiguity completely. Defaults to `JIRA_PROJECT_KEYS` (comma-separated) when set.
   */
  projectKeys?: string[];
  /** Log what would be sent without sending it. */
  dryRun?: boolean;
}

interface TestOutcome {
  title: string;
  status: string;
  durationMs: number;
  error?: string;
  controlTree?: string;
}

/**
 * A Playwright reporter that talks **straight to Jira** - no Xray, no Zephyr, no CI plugin in
 * between. See docs/jira.md.
 *
 * It links results back to issues by reading issue keys off your tests (from an annotation, a tag,
 * or anywhere in the title path), then after the run posts a summary comment to each issue it saw.
 * Optionally it also files a bug for each failure - with this framework's **UI5 control-tree dump
 * attached**, which is the piece that makes a UI5 failure diagnosable by whoever picks the bug up
 * (see docs/diagnostics.md).
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [['list'], ['playwright-sapui5/reporter/jira', { projectKey: 'ABC' }]],
 * ```
 *
 * ```ts
 * test('checkout completes', { annotation: { type: 'jira', description: 'ABC-123' } }, async ({ page }) => {
 *   // ...
 * });
 * ```
 *
 * **On safety.** This writes to a system your whole team reads, so the defaults are conservative:
 * commenting is on, filing bugs is off until you ask for it, and with no credentials in the
 * environment the reporter does nothing at all rather than failing the run. Start with
 * `dryRun: true` to see exactly what it would post.
 */
export default class JiraReporter implements Reporter {
  private readonly options: JiraReporterOptions;
  private client?: JiraClient;
  private readonly outcomes = new Map<string, TestOutcome[]>();
  private disabledReason?: string;
  private readonly projectKeys?: string[];

  constructor(options: JiraReporterOptions = {}) {
    this.options = options;
    // Env fallback so the allowlist can be set per-environment alongside the credentials.
    const fromEnv = process.env.JIRA_PROJECT_KEYS?.split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    this.projectKeys = options.projectKeys ?? (fromEnv?.length ? fromEnv : undefined);
  }

  onBegin(_config: FullConfig): void {
    // Explicit options win; otherwise fall back to the environment, so credentials never have to
    // live in a committed config file.
    const fromEnv = jiraOptionsFromEnv();
    const baseUrl = this.options.baseUrl ?? fromEnv?.baseUrl;
    const merged: JiraClientOptions | undefined = baseUrl
      ? {
          ...fromEnv,
          ...this.options,
          baseUrl,
          dryRun: this.options.dryRun ?? fromEnv?.dryRun,
        }
      : undefined;

    if (!merged) {
      // Not an error: a developer running tests locally without Jira credentials should get a
      // normal test run, not a failure about reporting.
      this.disabledReason =
        'no Jira credentials found (set JIRA_BASE_URL plus either JIRA_PAT, or JIRA_EMAIL and JIRA_API_TOKEN)';
      return;
    }

    try {
      this.client = new JiraClient(merged);
    } catch (error) {
      this.disabledReason = error instanceof Error ? error.message : String(error);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this.options.failuresOnly && result.status === 'passed') return;

    const keys = issueKeysForTest(
      {
        title: test.title,
        titlePath: test.titlePath(),
        annotations: test.annotations,
        // `tags` arrived in newer Playwright versions; tolerate its absence rather than requiring
        // a minimum version for the whole framework.
        tags: (test as TestCase & { tags?: string[] }).tags,
      },
      { projectKeys: this.projectKeys },
    );
    if (keys.length === 0) return;

    const outcome: TestOutcome = {
      title: test.titlePath().filter(Boolean).join(' › '),
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message?.split('\n').slice(0, 6).join('\n'),
      // The control-tree attachment this framework adds to every failure - by far the most useful
      // thing to hand to whoever picks up the bug.
      controlTree: result.attachments
        .find((a) => a.name === 'ui5-control-tree.txt')
        ?.body?.toString(),
    };

    for (const key of keys) {
      const list = this.outcomes.get(key) ?? [];
      list.push(outcome);
      this.outcomes.set(key, list);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.outcomes.size === 0) return;

    if (!this.client) {
      console.log(`[playwright-sapui5] Jira reporting skipped: ${this.disabledReason}.`);
      return;
    }

    const comment = this.options.comment ?? true;
    for (const [issueKey, outcomes] of this.outcomes) {
      try {
        if (comment) {
          await this.client.addComment(issueKey, renderComment(issueKey, outcomes, result.status));
        }
        if (this.options.createIssueOnFailure) {
          await this.fileBugsFor(issueKey, outcomes);
        }
      } catch (error) {
        // One unreachable issue (deleted, renamed, no permission) must not fail the run or stop
        // the remaining issues from being updated.
        console.log(
          `[playwright-sapui5] Jira update for ${issueKey} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const verb = this.options.dryRun ? 'would update' : 'updated';
    console.log(`[playwright-sapui5] Jira: ${verb} ${this.outcomes.size} issue(s).`);
  }

  private async fileBugsFor(issueKey: string, outcomes: TestOutcome[]): Promise<void> {
    const failures = outcomes.filter((outcome) => outcome.status !== 'passed');
    if (failures.length === 0) return;
    if (!this.options.projectKey) {
      console.log(
        '[playwright-sapui5] Jira: createIssueOnFailure is on but no projectKey was given - skipping bug creation.',
      );
      return;
    }

    for (const failure of failures) {
      const createdKey = await this.client!.createIssue({
        projectKey: this.options.projectKey,
        issueType: this.options.issueType ?? 'Bug',
        summary: `Test failed: ${failure.title}`.slice(0, 250),
        description: renderBugDescription(issueKey, failure),
        fields: this.options.issueFields,
      });

      if (createdKey && failure.controlTree) {
        await this.client!.addAttachment(createdKey, 'ui5-control-tree.txt', failure.controlTree);
      }
    }
  }
}

/** The run summary posted to an issue. Plain text on purpose - it renders acceptably as both ADF
 * and wiki markup, which a table or code block would not. */
export function renderComment(
  issueKey: string,
  outcomes: TestOutcome[],
  runStatus: string,
): string {
  const passed = outcomes.filter((outcome) => outcome.status === 'passed').length;
  const failed = outcomes.length - passed;
  const lines = [
    `Automated test results for ${issueKey} - ${passed} passed, ${failed} failed (run: ${runStatus}).`,
    '',
  ];
  for (const outcome of outcomes) {
    lines.push(
      `${outcome.status === 'passed' ? 'PASS' : 'FAIL'}  ${outcome.title}  (${Math.round(outcome.durationMs)}ms)`,
    );
    if (outcome.error) lines.push(`      ${outcome.error.split('\n')[0]}`);
  }
  lines.push('');
  lines.push('Posted by playwright-sapui5.');
  return lines.join('\n');
}

/** The body of a filed bug. The control tree goes in as an attachment rather than inline - it can
 * run to thousands of lines, which would make the issue unreadable. */
export function renderBugDescription(issueKey: string, failure: TestOutcome): string {
  return [
    `Automated test failure, from the suite covering ${issueKey}.`,
    '',
    `Test:     ${failure.title}`,
    `Status:   ${failure.status}`,
    `Duration: ${Math.round(failure.durationMs)}ms`,
    '',
    'Error:',
    failure.error ?? '(no error message captured)',
    '',
    failure.controlTree
      ? 'The SAPUI5 control tree at the moment of failure is attached as ui5-control-tree.txt - it lists every control that was actually rendered, which is usually enough to tell a genuine regression from a stale locator.'
      : 'No SAPUI5 control tree was captured for this failure.',
    '',
    'Filed by playwright-sapui5.',
  ].join('\n');
}
