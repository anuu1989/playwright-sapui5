import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A tiny in-memory stand-in for Black Duck and SVM, used by `npm run demo` and the integration
 * tests. It implements only what this package calls, with response shapes taken from the
 * assumptions in src/bd-client.ts and verify/svm-api.ts. It proves the HTTP plumbing and the state
 * machine are self-consistent; it does NOT prove the real Black Duck/SVM behave this way.
 */
export interface MockOptions {
  port?: number;
  /** How often SVM copies the Black Duck BOM (the "sync"). */
  syncEveryMs?: number;
  /** Accept the remove SBOM but ignore it (Black Duck skipping it as a duplicate). */
  ignoreReplace?: boolean;
  /** Answer the remove SBOM upload with 403. */
  blockRemoval?: boolean;
  /** Vulnerabilities by "name@version". */
  vulns?: Record<string, string[]>;
}

type Comp = { name: string; version: string };
interface CodeLocation {
  id: string;
  name: string;
  mapped: string; // version name, '' when unmapped
  components: Comp[];
}

export interface MockHandle {
  url: string;
  close(): Promise<void>;
  state: { codeLocations: CodeLocation[]; svm: Map<string, Comp[]> };
  syncNow(): void;
}

const DEFAULT_VULNS: Record<string, string[]> = { 'log4j-core@2.14.1': ['CVE-2021-44228'] };

export async function startMock(opts: MockOptions = {}): Promise<MockHandle> {
  const vulns = opts.vulns ?? DEFAULT_VULNS;
  const project = { id: 'proj1', name: 'svm-e2e-sync' };
  const versions: { id: string; versionName: string }[] = [];
  const codeLocations: CodeLocation[] = [];
  const svm = new Map<string, Comp[]>();
  let base = '';
  let seq = 0;

  const bom = (versionName: string): Comp[] =>
    codeLocations.filter((c) => c.mapped === versionName).flatMap((c) => c.components);
  const allBom = (): Comp[] => versions.flatMap((v) => bom(v.versionName));
  const syncNow = () => svm.set(project.name, allBom());
  const timer = setInterval(syncNow, opts.syncEveryMs ?? 3000);
  timer.unref();

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });
  const versionOf = (id: string) => versions.find((v) => v.id === id);

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base || 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    const m = req.method;
    let r: RegExpMatchArray | null;

    // ---- Black Duck ----
    if (m === 'POST' && path === '/api/tokens/authenticate') {
      if (!req.headers.authorization?.startsWith('token ')) return json(res, 401, {});
      return json(res, 200, { bearerToken: 'mock-bearer' });
    }
    if (
      path.startsWith('/api/') &&
      !path.startsWith('/api/assets/') &&
      req.headers.authorization !== 'Bearer mock-bearer'
    )
      return json(res, 401, {});
    if (m === 'GET' && path === '/api/projects') {
      return json(res, 200, {
        items: [{ name: project.name, _meta: { href: `${base}/api/projects/${project.id}` } }],
      });
    }
    if ((r = path.match(/^\/api\/projects\/[^/]+\/versions$/))) {
      if (m === 'POST') {
        const { versionName } = JSON.parse(await readBody(req));
        versions.push({ id: `ver${++seq}`, versionName });
        return json(res, 201, {});
      }
      return json(res, 200, {
        items: versions.map((v) => ({
          versionName: v.versionName,
          _meta: { href: `${base}/api/projects/${project.id}/versions/${v.id}` },
        })),
      });
    }
    if ((r = path.match(/^\/api\/projects\/[^/]+\/versions\/([^/]+)\/components$/))) {
      const v = versionOf(r[1]);
      return json(res, 200, {
        items: (v ? bom(v.versionName) : []).map((c) => ({
          componentName: c.name,
          componentVersionName: c.version,
        })),
      });
    }
    if (
      (r = path.match(/^\/api\/projects\/[^/]+\/versions\/([^/]+)\/vulnerable-bom-components$/))
    ) {
      const v = versionOf(r[1]);
      const items = (v ? bom(v.versionName) : []).flatMap((c) =>
        (vulns[`${c.name}@${c.version}`] ?? []).map((id) => ({
          componentName: c.name,
          componentVersionName: c.version,
          vulnerabilityWithRemediation: { vulnerabilityName: id },
        })),
      );
      return json(res, 200, { items });
    }
    if (m === 'POST' && path === '/api/scan/data') {
      const sbom = JSON.parse(await readBody(req));
      const phase = sbom.metadata?.properties?.find(
        (p: { name: string }) => p.name === 'e2e:phase',
      )?.value;
      if (phase === 'remove' && opts.blockRemoval) return json(res, 403, {});
      const name = url.searchParams.get('codeLocationName') ?? '';
      const versionName = url.searchParams.get('versionName') ?? '';
      if (phase === 'remove' && opts.ignoreReplace) return json(res, 201, {});
      let cl = codeLocations.find((c) => c.name === name);
      if (!cl)
        codeLocations.push((cl = { id: `cl${++seq}`, name, mapped: versionName, components: [] }));
      cl.components = (sbom.components ?? []).map((c: Comp) => ({
        name: c.name,
        version: c.version,
      })); // mode=replace
      return json(res, 201, {});
    }
    if (m === 'GET' && path === '/api/codelocations') {
      const items = codeLocations.map((c) => ({
        name: c.name,
        mappedProjectVersion: c.mapped
          ? `${base}/api/projects/${project.id}/versions/${c.mapped}`
          : undefined,
        _meta: { href: `${base}/api/codelocations/${c.id}` },
      }));
      return json(res, 200, { items });
    }
    if (m === 'PUT' && (r = path.match(/^\/api\/codelocations\/([^/]+)$/))) {
      const cl = codeLocations.find((c) => c.id === r![1]);
      if (!cl) return json(res, 404, {});
      cl.mapped = JSON.parse(await readBody(req)).mappedProjectVersion;
      return json(res, 200, {});
    }

    // ---- SVM ----
    if (m === 'GET' && (r = path.match(/^\/api\/assets\/([^/]+)\/components$/))) {
      const comps = svm.get(decodeURIComponent(r[1]));
      if (!comps) return json(res, 404, {});
      return json(res, 200, {
        items: comps.map((c) => ({
          name: c.name,
          version: c.version,
          vulnerabilities: (vulns[`${c.name}@${c.version}`] ?? []).map((id) => ({ id })),
        })),
      });
    }
    if (m === 'GET' && (r = path.match(/^\/assets\/([^/]+)$/))) {
      const rows = (svm.get(decodeURIComponent(r[1])) ?? [])
        .map((c) => `<tr><td>${c.name}</td><td>${c.version}</td></tr>`)
        .join('');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<!doctype html><title>SVM asset</title><table><tr><th>Component</th><th>Version</th></tr>${rows}</table>`,
      );
    }
    json(res, 404, { error: `no mock route for ${m} ${path}` });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    state: { codeLocations, svm },
    syncNow,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        server.close(() => resolve());
      }),
  };
}
