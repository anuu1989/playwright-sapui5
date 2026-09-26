import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import type { Ui5ControlDump } from './types';

/**
 * Turning a page's live SAPUI5 control tree into something a human can read at a glance. See
 * docs/diagnostics.md.
 *
 * This is what makes a failed locator diagnosable. `"resolved to 0 elements"` tells you what
 * *isn't* there; what you actually need is what **is** - which controls the app had rendered at
 * the moment the assertion gave up, what types they were, and what text they carried. Digging
 * that out by hand means re-running with `--headed`, pausing at the right moment, and poking at
 * `sap.ui.getCore()` in a console. Attaching it to the failure automatically (see
 * `src/fixtures/test.ts`) means it's simply in the report.
 */

/** How many controls of each type are on the page, most numerous first. */
export function summarizeByType(dump: Ui5ControlDump[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const control of dump) counts.set(control.type, (counts.get(control.type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * A compact, human-readable rendering of the control tree: a type histogram, then every control
 * that carries visible text, with its id.
 *
 * Deliberately text rather than JSON for the *first* thing a reader sees - the full JSON is
 * attached alongside for grepping, but nobody diagnoses a failure by reading 4,000 lines of it.
 * The text list answers the two questions that actually come up ("was my control there at all?"
 * and "what text did it really have?") in a form you can scan.
 */
export function formatControlTree(
  dump: Ui5ControlDump[],
  options: { maxRows?: number } = {},
): string {
  const maxRows = options.maxRows ?? 200;
  if (dump.length === 0) {
    return 'No SAPUI5 controls were rendered on this page.\n\nEither UI5 never booted here, or the page had already navigated away by the time this snapshot was taken.';
  }

  const lines: string[] = [];
  lines.push(`SAPUI5 control tree: ${dump.length} rendered controls`);
  lines.push('');
  lines.push('By type:');
  for (const { type, count } of summarizeByType(dump)) {
    lines.push(`  ${String(count).padStart(4)}  ${type}`);
  }

  const withText = dump.filter((control) => Object.keys(control.properties ?? {}).length > 0);
  lines.push('');
  lines.push(`Controls carrying text (${withText.length}):`);
  for (const control of withText.slice(0, maxRows)) {
    const texts = Object.entries(control.properties)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    lines.push(`  [${control.type}] ${control.id}`);
    lines.push(`      ${texts}`);
  }
  if (withText.length > maxRows) {
    lines.push(
      `  ... and ${withText.length - maxRows} more (see the attached JSON for all of them)`,
    );
  }

  return lines.join('\n');
}

/**
 * Reads the control tree and renders it. Never throws: a page that's already closed, navigated
 * away, or never ran UI5 at all is a perfectly ordinary situation when something has just failed,
 * and diagnostics that blow up while reporting a failure only make it harder to see the real one.
 */
export async function captureControlTree(
  target: Ui5Target,
): Promise<{ dump: Ui5ControlDump[]; text: string }> {
  try {
    const dump = await Ui5Bridge.dumpControlTree(target);
    return { dump, text: formatControlTree(dump) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      dump: [],
      text: `Could not capture the SAPUI5 control tree: ${reason}\n\n(The page may have been closed or navigated away before diagnostics ran.)`,
    };
  }
}
