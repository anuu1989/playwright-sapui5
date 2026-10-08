import { randomUUID } from 'node:crypto';
import type { ComponentSpec } from './config';

export interface SbomInput {
  runId: string;
  projectName: string;
  vulnerable: ComponentSpec;
  control: ComponentSpec;
}

function bom(input: SbomInput, phase: 'add' | 'remove', components: ComponentSpec[]) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: { type: 'application', name: input.runId, version: '1.0.0' },
      // Unique run marker so Black Duck never treats the replacement scan as a duplicate.
      properties: [
        { name: 'e2e:run', value: input.runId },
        { name: 'e2e:phase', value: phase },
        { name: 'e2e:nonce', value: randomUUID() },
      ],
    },
    components: components.map((c) => ({
      type: 'library',
      'bom-ref': c.purl,
      name: c.name,
      version: c.version,
      purl: c.purl,
    })),
  };
}

/** Vulnerable component + control component. */
export const buildAddSbom = (input: SbomInput) =>
  bom(input, 'add', [input.vulnerable, input.control]);

/** Same code location, vulnerable component removed; the control keeps the scan non-empty. */
export const buildRemoveSbom = (input: SbomInput) => bom(input, 'remove', [input.control]);
