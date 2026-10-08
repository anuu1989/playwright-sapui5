import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import type { Settings } from '../src/config';
import { InfraError } from '../src/errors';

export interface DueRun {
  runId: string;
  projectName: string;
  component: string;
  version: string;
  control: string;
  controlVersion: string;
  vulnIds: string[];
}

export interface SvmComponent {
  name: string;
  version: string;
  vulnIds: string[];
}

// Adapt this to the real SVM response (Phase 0 spike). Both a bare array and { items: [...] } are accepted.
const comp = z.object({
  name: z.string(),
  version: z.string(),
  vulnerabilities: z.array(z.union([z.string(), z.object({ id: z.string() })])).default([]),
});
const response = z.union([
  z.array(comp),
  z.object({ items: z.array(comp) }).transform((r) => r.items),
]);

/** Components SVM holds for the Black Duck project. Non-2xx and bad shapes are ERROR, not FAIL. */
export async function getAssetComponents(
  request: APIRequestContext,
  cfg: Settings,
  run: DueRun,
): Promise<SvmComponent[]> {
  const url =
    cfg.svm.api_url +
    cfg.svm.components_path.replace('{project}', encodeURIComponent(run.projectName));
  const res = await request.get(url, {
    headers: { Authorization: `Bearer ${process.env.SVM_API_TOKEN ?? ''}` },
  });
  if (res.status() === 404) return []; // asset not synced yet: a miss, not an infrastructure error
  if (!res.ok()) throw new InfraError(res.status(), `SVM API ${res.status()} for ${url}`);
  const parsed = response.safeParse(await res.json());
  if (!parsed.success)
    throw new InfraError(undefined, `Unexpected SVM response: ${parsed.error.message}`);
  return parsed.data.map((c) => ({
    name: c.name,
    version: c.version,
    vulnIds: c.vulnerabilities.map((v) => (typeof v === 'string' ? v : v.id)),
  }));
}
