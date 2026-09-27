import { test, expect } from '../../src';
import { extractIssueKeys, issueKeysForTest, toAtlassianDocument } from '../../src';

/**
 * Covers the pure parts of the Jira integration - issue-key extraction and Atlassian Document
 * Format rendering. No browser and no Jira involved, which is exactly why these are worth testing
 * here: they're the pieces whose edge cases would otherwise only show up against a real Jira.
 * See docs/jira.md.
 */
test.describe('Jira integration', () => {
  test('extracts issue keys, and only real ones', async () => {
    expect(extractIssueKeys('checkout works @ABC-123')).toEqual(['ABC-123']);
    expect(extractIssueKeys('ABC-1 and SAPUI5-4242 and X1_Y-7')).toEqual([
      'ABC-1',
      'SAPUI5-4242',
      'X1_Y-7',
    ]);

    // Same key twice is still one issue.
    expect(extractIssueKeys('ABC-123 relates to ABC-123')).toEqual(['ABC-123']);

    // Ruled out by shape: a lowercase key, and a date fragment (no leading letter).
    expect(extractIssueKeys('lowercase abc-123 is not a key')).toEqual([]);
    expect(extractIssueKeys('released 2024-11')).toEqual([]);
  });

  test('a project-key allowlist is what rules out UTF-8 and friends', async () => {
    // A Jira key's shape is genuinely indistinguishable from these, so the bare regex matches
    // them - which would mean commenting on issues that don't exist.
    expect(extractIssueKeys('encoding is UTF-8')).toEqual(['UTF-8']);
    expect(extractIssueKeys('hashed with SHA-1')).toEqual(['SHA-1']);

    // Naming the real projects removes the ambiguity entirely. This is why `projectKeys` is
    // recommended for any real use.
    const options = { projectKeys: ['ABC', 'SAPUI5'] };
    expect(extractIssueKeys('encoding is UTF-8', options)).toEqual([]);
    expect(extractIssueKeys('fixes ABC-123 and SHA-1 drift', options)).toEqual(['ABC-123']);
    expect(extractIssueKeys('SAPUI5-42 and NOPE-1', options)).toEqual(['SAPUI5-42']);

    // And it applies through the test-level lookup too.
    expect(issueKeysForTest({ title: 'uses UTF-8 @ABC-9' }, { projectKeys: ['ABC'] })).toEqual([
      'ABC-9',
    ]);
  });

  test('finds keys in annotations, tags and the title path alike', async () => {
    // The explicit, greppable form.
    expect(
      issueKeysForTest({
        title: 'checkout completes',
        annotations: [{ type: 'jira', description: 'ABC-123' }],
      }),
    ).toEqual(['ABC-123']);

    // A tag.
    expect(issueKeysForTest({ title: 'checkout', tags: ['@ABC-456'] })).toEqual(['ABC-456']);

    // Anywhere in the title path, so a describe block can cover every test inside it.
    expect(
      issueKeysForTest({
        title: 'adds an item',
        titlePath: ['', 'cart.spec.ts', 'ABC-789 Shopping cart', 'adds an item'],
      }),
    ).toEqual(['ABC-789']);

    // All three at once, de-duplicated.
    expect(
      issueKeysForTest({
        title: 'does a thing @ABC-1',
        titlePath: ['ABC-2 Suite', 'does a thing @ABC-1'],
        annotations: [{ type: 'jira', description: 'ABC-1' }],
      }),
    ).toEqual(['ABC-1', 'ABC-2']);

    expect(issueKeysForTest({ title: 'no key here' })).toEqual([]);
  });

  test('renders Atlassian Document Format that Jira Cloud will accept', async () => {
    const doc = toAtlassianDocument('first line\n\nthird line') as {
      type: string;
      version: number;
      content: { type: string; content: { text: string }[] }[];
    };

    expect(doc.type).toBe('doc');
    expect(doc.version).toBe(1);
    expect(doc.content).toHaveLength(3);
    expect(doc.content[0].content[0].text).toBe('first line');

    // The blank line becomes an empty paragraph rather than a text node holding an empty string -
    // ADF rejects the latter, which is the kind of thing that only surfaces as a 400 from Jira.
    expect(doc.content[1].content).toEqual([]);
    expect(doc.content[2].content[0].text).toBe('third line');
  });
});
