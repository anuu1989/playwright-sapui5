/**
 * Tiny, shared helpers for building CSS attribute selectors from SAPUI5 control ids - used
 * anywhere in this codebase that needs to turn a control id (or several) into a Playwright
 * selector string: `SelfHealingResolver`, `Ui5Table`, and `Ui5Dialog`.
 */

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

/** Builds a selector matching *any* of several control ids at once, using CSS's own
 * comma-separated "selector list" syntax - `page.locator(idsSelector([...]))` matches every one
 * of them in a single `Locator`. */
export function idsSelector(ids: string[]): string {
  return ids.map(idSelector).join(', ');
}
