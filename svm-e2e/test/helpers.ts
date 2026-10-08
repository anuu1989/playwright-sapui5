import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BdApi, BomComponent } from '../src/bd-client';
import { loadSettings } from '../src/config';
import type { Deps } from '../src/orchestrator';
import type { ScanUploader } from '../src/scan-uploader';
import { RunStore } from '../src/store';

export class FakeBd implements BdApi {
  bom: BomComponent[] = [];
  mapped = true;
  unmapCalls = 0;
  vulns = ['CVE-2021-44228'];
  ensureVersion = async () => ({ projectId: 'p1', versionId: 'v1' });
  getBomComponents = async () => this.bom;
  getComponentVulns = async () => this.vulns;
  findCodeLocation = async () => ({ id: 'cl1', mapped: this.mapped });
  unmapCodeLocation = async () => {
    this.unmapCalls++;
    this.mapped = false;
    this.bom = this.bom.filter((c) => c.name === 'slf4j-api');
  };
}

export class FakeUploader implements ScanUploader {
  uploads: { phase: string; components: string[] }[] = [];
  /** When true, a remove upload is accepted but Black Duck ignores it (duplicate detection). */
  ignoreRemove = false;
  constructor(private bd: FakeBd) {}
  async upload(req: { sbom: object }) {
    const sbom = req.sbom as {
      metadata: { properties: { name: string; value: string }[] };
      components: { name: string; version: string }[];
    };
    const phase = sbom.metadata.properties.find((p) => p.name === 'e2e:phase')!.value;
    this.uploads.push({ phase, components: sbom.components.map((c) => c.name) });
    if (phase === 'remove' && this.ignoreRemove) return;
    this.bd.bom = sbom.components.map((c) => ({ name: c.name, version: c.version }));
  }
}

export function setup(start = new Date('2026-01-01T00:00:00Z')) {
  const clock = { t: start.getTime() };
  const now = () => new Date(clock.t);
  const bd = new FakeBd();
  const uploader = new FakeUploader(bd);
  const store = new RunStore(join(mkdtempSync(join(tmpdir(), 'svm-e2e-')), 'runs.json'), now);
  const cfg = loadSettings();
  const deps: Deps = { bd, uploader, store, cfg, now, sleep: async () => {}, log: () => {} };
  const advance = (ms: number) => (clock.t += ms);
  return { bd, uploader, store, cfg, deps, advance, clock };
}
