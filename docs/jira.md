# Jira integration (straight to Jira, no middleman)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

This framework can talk **directly to Jira's REST API**. There is no Xray, no Zephyr, no CI
plugin and no Jira SDK in between - the reporter posts to your Jira with the credentials you give
it, and you can see exactly what it would send before it sends anything.

What it does, after a run finishes:

1. Works out which Jira issues each test belongs to, by reading issue keys off the test itself.
2. Posts a **run summary comment** to each of those issues.
3. Optionally **files a bug** for each failure - with this framework's
   [UI5 control-tree dump](diagnostics.md) attached, which is the piece that makes a UI5 failure
   diagnosable by whoever picks the bug up.

## Setup

Credentials come from the environment, so they never have to live in a committed config file.

**Jira Cloud** (`*.atlassian.net`) - create an API token at
[id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens):

```bash
export JIRA_BASE_URL="https://your-org.atlassian.net"
export JIRA_EMAIL="you@your-company.com"
export JIRA_API_TOKEN="your-api-token"
export JIRA_PROJECT_KEYS="ABC,SAPUI5"   # strongly recommended - see the caveat below
```

**Jira Server / Data Center** - create a personal access token in your Jira profile:

```bash
export JIRA_BASE_URL="https://jira.your-company.com"
export JIRA_PAT="your-personal-access-token"
export JIRA_PROJECT_KEYS="ABC,SAPUI5"
```

Then add the reporter to your Playwright config:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['playwright-sapui5/reporter/jira']],
});
```

That's the whole setup. Run your tests as usual.

### Which flavour am I on?

The client works both out, because they differ in ways that fail immediately and confusingly:

|              | Jira **Cloud**              | Jira **Server / Data Center**   |
| ------------ | --------------------------- | ------------------------------- |
| REST path    | `/rest/api/3`               | `/rest/api/2`                   |
| Auth         | Basic, `email:apiToken`     | Bearer, a personal access token |
| Comment body | ADF, a nested JSON document | a plain wiki-markup string      |

That last row is the one that bites. Posting a plain string to Cloud's v3 endpoint is rejected
outright, and posting ADF to a Server instance "succeeds" - it stores a JSON blob as the visible
comment text. The framework picks the right one for you: a `JIRA_PAT` means Server/DC, an email +
token pair means Cloud. If your instance doesn't follow that pattern, set
`JIRA_DEPLOYMENT=cloud` or `JIRA_DEPLOYMENT=server` explicitly.

## Linking a test to an issue

Use whichever of these three your team already uses - all of them work, and they can be mixed
freely in one suite.

**An annotation** - the explicit, greppable way:

```ts
test(
  'checkout completes',
  { annotation: { type: 'jira', description: 'ABC-123' } },
  async ({ page }) => {
    // ...
  },
);
```

**A tag**, either in the title or via Playwright's `tag` option:

```ts
test('checkout completes @ABC-123', async ({ page }) => {
  /* ... */
});
test('checkout completes', { tag: '@ABC-123' }, async ({ page }) => {
  /* ... */
});
```

**Anywhere in the title path**, so one `describe` block covers every test inside it without
repeating the key:

```ts
test.describe('ABC-123 Shopping cart', () => {
  test('adds a product', async ({ page }) => {
    /* ... */
  });
  test('removes a product', async ({ page }) => {
    /* ... */
  });
});
```

Tests with no issue key are simply ignored by the reporter. One test can reference several issues,
and several tests can reference one issue - the comment posted to an issue summarises every test
that mentioned it.

## The `UTF-8` problem (read this one)

A Jira key is "uppercase letters, a hyphen, a number". So is `UTF-8`. So is `SHA-1`, and
`RFC-2616`, and `HTTP-2`. **There is no regex that can tell them apart** - a test titled
`'encoding is UTF-8'` genuinely looks like it references a `UTF-8` issue, and this framework's own
test suite caught exactly that happening.

The fix is to say which project keys are real:

```ts
reporter: [['playwright-sapui5/reporter/jira', { projectKeys: ['ABC', 'SAPUI5'] }]],
```

or set `JIRA_PROJECT_KEYS=ABC,SAPUI5` in the environment. With that in place the ambiguity is gone
completely: `extractIssueKeys('encoding is UTF-8', { projectKeys: ['ABC'] })` returns `[]`, while
`'fixes ABC-123 and SHA-1 drift'` returns just `['ABC-123']`.

Configure it. Without it, the worst case is a failed API call logged to your console; with it,
there's nothing to get wrong.

## See what it would do first

`dryRun` logs every request instead of sending it. Nothing reaches Jira:

```ts
reporter: [['playwright-sapui5/reporter/jira', { dryRun: true, projectKeys: ['ABC'] }]],
```

Because this writes to a system your whole team reads, the defaults are deliberately
conservative:

- Commenting is **on**; filing bugs is **off** until you turn it on.
- With no credentials in the environment, the reporter does **nothing at all** and says so. A
  developer running tests locally gets a normal test run, not a failure about reporting.
- One unreachable issue - deleted, renamed, no permission - is logged and skipped. It never fails
  the run, and never stops the remaining issues from being updated.

## Filing bugs automatically

Off by default, because a flaky suite pointed at a shared Jira project produces a lot of noise.
When you do want it, a project key for the bugs is required:

```ts
reporter: [
  ['list'],
  [
    'playwright-sapui5/reporter/jira',
    {
      projectKeys: ['ABC'],
      createIssueOnFailure: true,
      projectKey: 'ABC', // where the new bugs go
      issueType: 'Bug',
      failuresOnly: true,
    },
  ],
],
```

Each filed bug gets the test's title, status, duration and error message, plus
**`ui5-control-tree.txt` as an attachment** - the full list of controls that were actually
rendered at the moment of failure. That attachment is the difference between a bug someone can
act on and one they have to reproduce first: it's usually enough to tell a genuine regression from
a stale locator. See [docs/diagnostics.md](diagnostics.md).

Note the two similarly-named options: `projectKeys` (plural) is the allowlist for _reading_ keys
off your tests; `projectKey` (singular) is where _newly created_ bugs are filed.

If your project makes components, versions or a custom field mandatory, pass them through
`issueFields` - they're merged into every created issue as-is, because required fields vary too
much between projects to guess at:

```ts
issueFields: {
  components: [{ name: 'Web UI' }],
  labels: ['automated', 'sapui5'],
  customfield_10001: 'Regression',
},
```

## All reporter options

| Option                 | Default             | What it does                                                                         |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `comment`              | `true`              | Post a run summary comment on each referenced issue                                  |
| `createIssueOnFailure` | `false`             | Also file a bug per failing test                                                     |
| `projectKey`           | -                   | Project the filed bugs go into. Required when `createIssueOnFailure` is on           |
| `issueType`            | `'Bug'`             | Issue type for filed bugs                                                            |
| `issueFields`          | -                   | Extra fields merged into every created issue                                         |
| `failuresOnly`         | `false`             | Only report failures, rather than every result                                       |
| `projectKeys`          | `JIRA_PROJECT_KEYS` | Your real project keys - see [the `UTF-8` problem](#the-utf-8-problem-read-this-one) |
| `dryRun`               | `false`             | Log what would be sent, send nothing                                                 |
| `baseUrl`              | `JIRA_BASE_URL`     | Your Jira's base URL                                                                 |
| `deployment`           | inferred            | `'cloud'` or `'server'`                                                              |
| `email` / `apiToken`   | env                 | Cloud credentials                                                                    |
| `personalAccessToken`  | env                 | Server/DC credentials                                                                |
| `timeoutMs`            | `15000`             | Per-request timeout                                                                  |

Explicit options always win over the environment.

## Using the client directly

The reporter is a thin layer over `JiraClient`, which you can use anywhere - a global teardown, a
custom reporter of your own, a one-off script:

```ts
import { JiraClient, jiraOptionsFromEnv } from 'playwright-sapui5';

const options = jiraOptionsFromEnv();
if (options) {
  const jira = new JiraClient(options);
  await jira.addComment('ABC-123', 'Nightly SAPUI5 regression passed.');

  const key = await jira.createIssue({
    projectKey: 'ABC',
    issueType: 'Bug',
    summary: 'Product list renders no rows on QA',
    description: 'Found by the nightly run.',
  });
  if (key) await jira.addAttachment(key, 'notes.txt', 'anything you like');
}
```

It covers exactly three calls - comment, create issue, attach file - because a general-purpose
Jira SDK is a large dependency to take on for that. `jiraOptionsFromEnv()` returns `undefined`
when there isn't enough in the environment to authenticate, which is what lets the reporter treat
"no Jira configured" as a skip rather than an error.

Every request is recorded on `client.requestLog`, so a test can assert on exactly what would be
sent without a Jira to point at.

## What's been verified, and what hasn't

Honesty matters more here than usual, because getting this wrong writes to your team's Jira.

**Verified** against a mock Jira HTTP server driven by real Playwright runs, asserting on the
exact bytes sent: the Cloud path (`/rest/api/3`, `Basic` auth, ADF comment bodies), the Server/DC
path (`/rest/api/2`, `Bearer` auth, plain-string bodies), issue creation returning a key,
multipart attachment upload carrying a real 217-control UI5 tree with the required
`X-Atlassian-Token: no-check` header, `failuresOnly`, and trailing-slash `baseUrl` handling. The
key-extraction logic is covered by tests in
[`examples/tests/jira.spec.ts`](../examples/tests/jira.spec.ts).

**Not verified**: no real Jira instance was involved. Field-level requirements, permission
schemes, workflow restrictions and custom issue types differ per instance and can only be checked
against yours. That is exactly what `dryRun: true` is for - run it once, read the log, then turn
it off.

## Related

- [docs/diagnostics.md](diagnostics.md) - the control-tree attachment the filed bugs carry
- [docs/multi-environment-config.md](multi-environment-config.md) - keeping credentials and URLs
  out of committed config
- [docs/api-reference.md](api-reference.md) - the exported types
