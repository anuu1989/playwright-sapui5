/**
 * Tiny, shared helpers for building CSS attribute selectors from SAPUI5 control ids - used
 * anywhere in this codebase that needs to turn a control id (or several) into a Playwright
 * selector string: `SelfHealingResolver`, `Ui5Table`, `Ui5GridTable`, `Ui5Dialog`, and
 * `Ui5ValueHelpDialog`.
 */

/** A selector that can structurally never match anything on any real page - see `idsSelector`
 * below for why a "no matches" case needs one, rather than an empty selector string. */
const NO_MATCH_SELECTOR = '[data-playwright-sapui5-no-match]';

/**
 * Escapes a control id so it's safe to embed inside a CSS attribute selector's double quotes
 * (`[id="..."]`). Only `\` and `"` themselves need escaping here - SAPUI5 ids can contain `-`,
 * `_`, `.`, `:`, letters and digits, none of which are special inside a quoted attribute value.
 */
export function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Builds a `[id="..."]` selector for one control id. */
export function idSelector(id: string): string {
  return `[id="${escapeAttrValue(id)}"]`;
}

/**
 * Builds a selector matching *any* of several control ids at once, using CSS's own
 * comma-separated "selector list" syntax - `target.locator(idsSelector([...]))` matches every one
 * of them in a single `Locator`. Given an empty array (a caller found zero matching controls -
 * e.g. `Ui5Table.rowContaining()` against a table with no rows right now), returns
 * `NO_MATCH_SELECTOR` rather than joining zero strings into `''`: an empty selector string is
 * invalid CSS and throws when handed to `target.locator(...)` ("Unexpected token"), which would
 * turn a legitimate "nothing matched" result into a confusing crash instead of a `Locator` that
 * correctly reports zero matches (`.count()` → `0`) the way every other "not found" path in this
 * framework behaves.
 */
export function idsSelector(ids: string[]): string {
  return ids.length === 0 ? NO_MATCH_SELECTOR : ids.map(idSelector).join(', ');
}
