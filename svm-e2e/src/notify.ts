import type { RunStore } from './store';
import { overallResult } from './store';
import type { RunRow } from './types';

export function summarize(run: RunRow): string {
  const delay = (seen?: string, since?: string) =>
    seen && since
      ? `${((new Date(seen).getTime() - new Date(since).getTime()) / 3_600_000).toFixed(1)}h`
      : 'n/a';
  return [
    `${overallResult(run)} ${run.runId} (${run.state})`,
    `component ${run.componentName}@${run.componentVersion}`,
    `add: ${run.addResult ?? '-'} (sync delay ${delay(run.svmAddSeenAt, run.addedAt)})`,
    `remove: ${run.removeResult ?? '-'} via ${run.removalMethod} (sync delay ${delay(run.svmRemoveSeenAt, run.removedAt)})`,
  ].join(' | ');
}

/** Posts a summary per finished run to SLACK_WEBHOOK_URL (Slack/Teams incoming webhook); logs if unset. */
export async function notifyFinished(
  store: RunStore,
  log: (m: string) => void = console.log,
): Promise<number> {
  const runs = store.finalUnnotified();
  for (const run of runs) {
    const text = summarize(run);
    const hook = process.env.SLACK_WEBHOOK_URL;
    if (hook) {
      const res = await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        log(`notify failed (${res.status}) for ${run.runId}; will retry next tick`);
        continue;
      }
    } else {
      log(text);
    }
    store.update(run.runId, { notified: true });
  }
  return runs.length;
}
