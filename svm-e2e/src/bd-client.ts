import { z } from 'zod';
import { BlockedError, InfraError } from './errors';

export interface BomComponent {
  name: string;
  version: string;
}

export interface BdProjectVersion {
  projectId: string;
  versionId: string;
}

/** What the orchestrator needs from Black Duck - lets tests swap in a fake. */
export interface BdApi {
  ensureVersion(project: string, version: string): Promise<BdProjectVersion>;
  getBomComponents(v: BdProjectVersion): Promise<BomComponent[]>;
  getComponentVulns(v: BdProjectVersion, name: string, version: string): Promise<string[]>;
  findCodeLocation(name: string): Promise<{ id: string; mapped: boolean } | undefined>;
  unmapCodeLocation(id: string): Promise<void>;
}

const idFromHref = (href: string) => href.split('/').filter(Boolean).pop() ?? '';
const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

const projectItem = z.object({ name: z.string(), _meta: z.object({ href: z.string() }) });
const versionItem = z.object({ versionName: z.string(), _meta: z.object({ href: z.string() }) });
const bomItem = z.object({
  componentName: z.string(),
  componentVersionName: z.string().optional(),
});
const vulnItem = z.object({
  componentName: z.string(),
  componentVersionName: z.string().optional(),
  vulnerabilityWithRemediation: z.object({ vulnerabilityName: z.string() }),
});
const codeLocationItem = z.object({
  name: z.string(),
  mappedProjectVersion: z.string().optional(),
  _meta: z.object({ href: z.string() }),
});

export class BdClient implements BdApi {
  private bearerToken?: string;

  constructor(
    private baseUrl: string,
    private apiToken: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** Exchange the API token for a bearer token. Confirm against your instance's /api-doc. */
  async bearer(): Promise<string> {
    if (this.bearerToken) return this.bearerToken;
    const res = await this.fetchImpl(`${this.baseUrl}/api/tokens/authenticate`, {
      method: 'POST',
      headers: { Authorization: `token ${this.apiToken}` },
    });
    if (res.status === 401 || res.status === 403) throw new BlockedError(res.status);
    if (!res.ok) throw new InfraError(res.status, 'Black Duck auth failed');
    const body = z.object({ bearerToken: z.string() }).parse(await res.json());
    this.bearerToken = body.bearerToken;
    return this.bearerToken;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.bearer();
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init.headers },
      });
    } catch (err) {
      throw new InfraError(undefined, `Black Duck unreachable: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new BlockedError(res.status);
    if (!res.ok)
      throw new InfraError(
        res.status,
        `Black Duck ${init.method ?? 'GET'} ${path} -> ${res.status}`,
      );
    return res;
  }

  private async getJson<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T>> {
    const res = await this.request(path);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success)
      throw new InfraError(
        undefined,
        `Unexpected Black Duck response for ${path}: ${parsed.error.message}`,
      );
    return parsed.data;
  }

  async ensureVersion(project: string, version: string): Promise<BdProjectVersion> {
    const projects = await this.getJson(
      `/api/projects?q=${encodeURIComponent(`name:${project}`)}&limit=100`,
      page(projectItem),
    );
    const p = projects.items.find((i) => i.name === project);
    if (!p)
      throw new InfraError(404, `Black Duck project "${project}" not found - create it first`);
    const projectId = idFromHref(p._meta.href);

    const find = async () => {
      const versions = await this.getJson(
        `/api/projects/${projectId}/versions?limit=1000`,
        page(versionItem),
      );
      return versions.items.find((v) => v.versionName === version);
    };
    let v = await find();
    if (!v) {
      await this.request(`/api/projects/${projectId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionName: version,
          phase: 'DEVELOPMENT',
          distribution: 'INTERNAL',
        }),
      });
      v = await find();
      if (!v) throw new InfraError(undefined, `Version "${version}" was not created`);
    }
    return { projectId, versionId: idFromHref(v._meta.href) };
  }

  async getBomComponents({ projectId, versionId }: BdProjectVersion): Promise<BomComponent[]> {
    const res = await this.getJson(
      `/api/projects/${projectId}/versions/${versionId}/components?limit=1000`,
      page(bomItem),
    );
    return res.items.map((i) => ({ name: i.componentName, version: i.componentVersionName ?? '' }));
  }

  async getComponentVulns(
    { projectId, versionId }: BdProjectVersion,
    name: string,
    version: string,
  ): Promise<string[]> {
    const res = await this.getJson(
      `/api/projects/${projectId}/versions/${versionId}/vulnerable-bom-components?limit=1000`,
      page(vulnItem),
    );
    return res.items
      .filter((i) => i.componentName === name && (i.componentVersionName ?? version) === version)
      .map((i) => i.vulnerabilityWithRemediation.vulnerabilityName);
  }

  async findCodeLocation(name: string) {
    const res = await this.getJson(
      `/api/codelocations?q=${encodeURIComponent(`name:${name}`)}&limit=100`,
      page(codeLocationItem),
    );
    const cl = res.items.find((i) => i.name === name);
    return cl ? { id: idFromHref(cl._meta.href), mapped: !!cl.mappedProjectVersion } : undefined;
  }

  /** Unmapping takes every component found by that scan out of the BOM. */
  async unmapCodeLocation(id: string): Promise<void> {
    await this.request(`/api/codelocations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappedProjectVersion: '' }),
    });
  }
}
