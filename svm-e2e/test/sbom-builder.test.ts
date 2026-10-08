import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config';
import { buildAddSbom, buildRemoveSbom } from '../src/sbom-builder';

const cfg = loadSettings();
const input = {
  runId: 'e2e-1',
  projectName: 'p',
  vulnerable: cfg.components[0],
  control: cfg.control_component,
};

describe('sbom-builder', () => {
  it('add SBOM has the vulnerable and control component', () => {
    expect(buildAddSbom(input).components.map((c) => c.name)).toEqual([
      cfg.components[0].name,
      cfg.control_component.name,
    ]);
  });
  it('remove SBOM keeps only the control and is never a duplicate of the add SBOM', () => {
    const add = buildAddSbom(input);
    const rem = buildRemoveSbom(input);
    expect(rem.components.map((c) => c.name)).toEqual([cfg.control_component.name]);
    expect(rem.serialNumber).not.toBe(add.serialNumber);
    expect(JSON.stringify(rem.metadata.properties)).not.toBe(
      JSON.stringify(add.metadata.properties),
    );
  });
});
