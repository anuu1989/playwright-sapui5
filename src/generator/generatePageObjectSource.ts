import type { Ui5ControlDump } from '../core/types';

/**
 * This file is a **pure function**: given the same `dump` and `className`, it always returns the
 * same string, and it never touches a file system, a browser, or anything else outside its own
 * arguments. That's a deliberate design choice - the browser automation part (getting a `dump` in
 * the first place, via `Ui5Bridge.dumpControlTree`) is kept entirely separate, in
 * `src/generator/cli.ts`, which makes this function trivial to test or reuse on its own.
 */

// Pure layout/container controls are excluded from generated output - they're rarely useful
// as named locators in a Page Object and would otherwise dominate the generated file.
const CONTAINER_TYPES = new Set([
  'sap.m.Page',
  'sap.m.App',
  'sap.m.SplitApp',
  'sap.m.SplitContainer',
  'sap.m.NavContainer',
  'sap.m.Panel',
  'sap.m.Toolbar',
  'sap.m.Bar',
  'sap.m.VBox',
  'sap.m.HBox',
  'sap.m.FlexBox',
  'sap.m.ScrollContainer',
  'sap.f.DynamicPage',
  'sap.f.DynamicPageTitle',
  'sap.f.DynamicPageHeader',
  'sap.ui.layout.VerticalLayout',
  'sap.ui.layout.HorizontalLayout',
  'sap.ui.layout.Grid',
  'sap.ui.layout.form.Form',
  'sap.ui.layout.form.SimpleForm',
  'sap.ui.core.mvc.XMLView',
  'sap.ui.core.mvc.View',
  'sap.ui.core.ComponentContainer',
]);

function isInterestingControlType(type: string): boolean {
  return !CONTAINER_TYPES.has(type);
}

/**
 * Turns an arbitrary string (a control id fragment, or a control type's last segment) into a
 * valid, camelCase JavaScript identifier - so it's safe to use as a `get <name>()` getter name.
 * E.g. `"save-button"` → `"saveButton"`, `"Save Button"` → `"saveButton"`.
 */
function toCamelCase(raw: string): string {
  const cleaned = raw
    // Replace every run of one-or-more non-alphanumeric characters (dashes, dots, spaces, ...)
    // with a single space, so "save-button" and "save button" end up identical after this step.
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean) // drop any empty strings left over from the split
    .map((word, i) =>
      // First word gets a lowercase first letter (camelCase starts lowercase); every other word
      // gets an uppercase first letter (that's the "hump" in camelCase) - e.g.
      // ["save", "button"] → "save" + "Button" → "saveButton".
      i === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
  if (!cleaned) return 'control'; // fallback if the input was entirely non-alphanumeric
  // A JavaScript identifier can't start with a digit - prefix with `_` if it would (e.g. an id
  // like "2fa-input" would otherwise camelCase to the invalid identifier "2faInput").
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * Makes a control's text/title/value safe to embed inside a single-line `//` comment. Two
 * problems this guards against: a value containing a literal newline would otherwise break out
 * of the comment and become invalid, uncommented code in the generated file (this really
 * happened during development - see docs/troubleshooting.md); a very long value would make the
 * generated file hard to skim, so anything past 60 characters is truncated with `...`.
 */
function sanitizeForComment(text: string): string {
  const collapsed = text.replace(/[\r\n\t]+/g, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}...` : collapsed;
}

/** Strips a control's view-scoped id prefix, if it has one: `"myView--saveButton"` becomes just
 * `"saveButton"` - the generated code then uses `this.id("saveButton")`, relying on `Ui5Locator`'s
 * own "ends with" suffix matching (see `src/browser/bridgeScript.ts`'s `findControlsById`) to
 * still find the control regardless of which view it's actually nested inside. The `!` after
 * `.pop()` is a "non-null assertion" - it tells TypeScript "I know this array isn't empty, don't
 * make me check" (safe here: `.split('--')` on a string containing `'--'` always returns at
 * least one non-empty segment to pop). */
function shortId(id: string): string {
  return id.includes('--') ? id.split('--').pop()! : id;
}

/**
 * Turns a control tree dump (from `Ui5Bridge.dumpControlTree`) into the source of a
 * `Ui5Page` subclass. The output is a starting point, not a finished file - review names
 * before committing, since they're derived mechanically from control ids/types.
 */
export function generatePageObjectSource(dump: Ui5ControlDump[], className: string): string {
  // `seen` tracks every generated name so far, purely to catch collisions: two different
  // controls could easily produce the same camelCase name (e.g. two buttons both ending up
  // called `button`) - see the `while (seen.has(name))` loop below for how that's resolved.
  const seen = new Set<string>();
  const members = dump
    .filter((c) => isInterestingControlType(c.type))
    .map((c) => {
      const idPart = shortId(c.id);
      // Prefer a name derived from the control's own id; only fall back to its control type
      // (e.g. "button" for an unnamed `sap.m.Button`) if the id itself didn't produce anything
      // usable (rare - `toCamelCase` only returns falsy-ish output for a fully non-alphanumeric
      // id, which is unusual but not impossible for auto-generated ids like `"__button4"`, since
      // every character there IS alphanumeric... this fallback mainly guards the edge case
      // where an id is something unexpected, like a lone punctuation string).
      const base = toCamelCase(idPart) || toCamelCase(c.type.split('.').pop() ?? 'control');
      let name = base;
      let n = 1;
      // If `base` is already taken, keep appending an increasing number (`button2`, `button3`,
      // ...) until an unused name is found.
      while (seen.has(name)) {
        n += 1;
        name = `${base}${n}`;
      }
      seen.add(name);
      return { name, idPart, type: c.type, properties: c.properties };
    });

  // The rest of this function builds the output file as an array of individual lines, then joins
  // them with `\n` at the very end - simple string concatenation would work too, but building an
  // array first (and using `.push(...)` throughout) keeps each line's construction easy to read
  // in isolation, especially inside the loop below.
  const lines: string[] = [];
  lines.push(`import type { Page } from '@playwright/test';`);
  lines.push(`import { Ui5Page } from 'playwright-sapui5';`);
  lines.push('');
  lines.push(`/**`);
  lines.push(` * Auto-generated by \`pw-sapui5 generate\`. Review before committing:`);
  lines.push(` * member names are derived from control ids and may not be meaningful.`);
  lines.push(` */`);
  lines.push(`export class ${className} extends Ui5Page {`);
  lines.push(`  constructor(page: Page) {`);
  lines.push(`    super(page);`);
  lines.push(`  }`);
  lines.push('');
  // One `get <name>()` getter per surviving control, each preceded by a `//` comment showing its
  // SAPUI5 control type and any text/title/value it exposes - see `Ui5ControlDump` in
  // `src/core/types.ts` for where `m.properties` comes from.
  for (const m of members) {
    const hint = Object.entries(m.properties)
      .map(([k, v]) => `${k}="${sanitizeForComment(v)}"`)
      .join(' ');
    lines.push(`  // ${m.type}${hint ? ` ${hint}` : ''}`);
    lines.push(`  get ${m.name}() {`);
    // `JSON.stringify(m.idPart)` rather than manually wrapping in quotes: it correctly escapes
    // any quote characters, backslashes, etc. that might appear inside the id itself, producing
    // a valid string literal no matter what the id actually contains.
    lines.push(`    return this.id(${JSON.stringify(m.idPart)});`);
    lines.push(`  }`);
    lines.push('');
  }
  lines.push(`}`);
  lines.push('');
  return lines.join('\n');
}
