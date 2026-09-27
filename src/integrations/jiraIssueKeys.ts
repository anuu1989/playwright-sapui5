/**
 * Working out which Jira issues a test belongs to. Pure string handling, no network - which is
 * what lets the interesting edge cases be tested without a Jira. See docs/jira.md.
 */

/**
 * A Jira issue key: a project key (uppercase letters/digits/underscore, starting with a letter)
 * then a hyphen and a number - `ABC-123`, `SAPUI5-42`, `X1_Y-7`.
 *
 * **This shape is genuinely ambiguous, and it matters.** `UTF-8`, `SHA-1` and `RFC-2616` are
 * structurally indistinguishable from Jira keys, so a test titled `'encoding is UTF-8'` will
 * match `UTF-8` and, left unchecked, produce a comment aimed at an issue that doesn't exist.
 * There is no regex that fixes this - the only reliable answer is to say which project keys are
 * real, which is what the `projectKeys` option below is for. Configure it and the ambiguity
 * disappears entirely.
 */
const ISSUE_KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/g;

/** Narrowing to known project keys. Recommended for any real use - see the note on `ISSUE_KEY`. */
export interface IssueKeyOptions {
  /** e.g. `['ABC', 'SAPUI5']`. When given, only keys in these projects are returned, so
   * `UTF-8`-shaped false positives can't get through. Case-sensitive, matching Jira. */
  projectKeys?: string[];
}

/** Every distinct issue key in a string, in the order they appear. */
export function extractIssueKeys(text: string, options: IssueKeyOptions = {}): string[] {
  const found = text.match(ISSUE_KEY) ?? [];
  const unique = [...new Set(found)];
  if (!options.projectKeys || options.projectKeys.length === 0) return unique;

  const allowed = new Set(options.projectKeys);
  return unique.filter((key) => allowed.has(key.slice(0, key.lastIndexOf('-'))));
}

/** What a Playwright test looks like to the key extractor. Kept structural rather than importing
 * Playwright's `TestCase` so this stays a pure module that can be reasoned about (and tested)
 * on its own. */
export interface TestLikeForJira {
  title: string;
  /** The full title path - project > file > describe > test. Searched too, so a `test.describe`
   * block can carry the key for every test inside it. */
  titlePath?: string[];
  annotations?: { type: string; description?: string }[];
  tags?: string[];
}

/**
 * Every issue key associated with a test, gathered from all three places people naturally put
 * them:
 *
 * - an **annotation**, which is the explicit, greppable way:
 *   `test('...', { annotation: { type: 'jira', description: 'ABC-123' } }, async () => {})`
 * - a **tag**: `test('checkout works @ABC-123', ...)` or Playwright's `{ tag: '@ABC-123' }`
 * - anywhere in the **title path**, so a `test.describe('ABC-123 Checkout', ...)` covers every
 *   test nested inside it without repeating the key
 *
 * Supporting all three matters because teams already have a convention, and a reporter that
 * insists on a different one just doesn't get adopted.
 */
export function issueKeysForTest(test: TestLikeForJira, options: IssueKeyOptions = {}): string[] {
  const sources: string[] = [];

  for (const annotation of test.annotations ?? []) {
    // `type: 'jira'` is the conventional one, but accept any annotation whose description holds a
    // key - people label them `issue`, `ticket`, `story`, and being strict here helps nobody.
    if (annotation.description) sources.push(annotation.description);
  }
  for (const tag of test.tags ?? []) sources.push(tag);
  for (const part of test.titlePath ?? [test.title]) sources.push(part);

  return [...new Set(sources.flatMap((source) => extractIssueKeys(source, options)))];
}
