import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const component = z.object({ name: z.string(), version: z.string(), purl: z.string() });

export const settingsSchema = z.object({
  blackduck: z.object({
    url: z.string().url(),
    project: z.string(),
    version_strategy: z.enum(['per_run', 'shared']).default('per_run'),
    shared_version: z.string().default('e2e-shared'),
    sbom_upload_path: z.string().default('/api/scan/data/'),
  }),
  svm: z.object({
    api_url: z.string().url(),
    ui_url: z.string().url(),
    components_path: z.string(),
    asset_ui_path: z.string(),
    asset_lookup: z.string().default('by_project_name'),
  }),
  timing: z.object({
    sync_wait_hours: z.number().positive().default(8),
    retry_every_minutes: z.number().positive().default(30),
    retry_window_hours: z.number().nonnegative().default(2),
    bom_ready_timeout_minutes: z.number().positive().default(30),
    removal_fallback_after_minutes: z.number().nonnegative().default(60),
    stuck_after_hours: z.number().positive().default(24),
  }),
  components: z.array(component).min(1),
  control_component: component,
});

export type Settings = z.infer<typeof settingsSchema>;
export type Timing = Settings['timing'];
export type ComponentSpec = z.infer<typeof component>;

export const PACKAGE_ROOT = resolve(__dirname, '..');

export function loadSettings(
  path = process.env.SVM_E2E_CONFIG ?? 'config/settings.yaml',
): Settings {
  const raw = readFileSync(resolve(PACKAGE_ROOT, path), 'utf8');
  const yaml = parse(raw);
  // Deployment URLs differ per environment (internal Black Duck/SVM), so env vars win over the YAML.
  const override = (section: 'blackduck' | 'svm', key: string, envName: string) => {
    const v = process.env[envName]?.trim().replace(/\/+$/, '');
    if (v) yaml[section] = { ...yaml[section], [key]: v };
  };
  override('blackduck', 'url', 'BD_URL');
  override('svm', 'api_url', 'SVM_API_URL');
  override('svm', 'ui_url', 'SVM_UI_URL');
  return settingsSchema.parse(yaml);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const storePath = (): string =>
  resolve(PACKAGE_ROOT, process.env.STORE_PATH ?? '.data/e2e_runs.json');
