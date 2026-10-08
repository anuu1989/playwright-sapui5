export type RunState =
  | 'ADDED'
  | 'WAITING_ADD_SYNC'
  | 'ADD_VERIFIED'
  | 'REMOVING' // remove SBOM uploaded (or unmapped); waiting for Black Duck to drop the component
  | 'REMOVED'
  | 'REMOVE_VERIFIED'
  | 'ADD_TIMEOUT'
  | 'ADD_FAILED'
  | 'REMOVAL_BLOCKED'
  | 'REMOVE_TIMEOUT'
  | 'REMOVE_FAILED';

export const FINAL_STATES: readonly RunState[] = [
  'REMOVE_VERIFIED',
  'ADD_TIMEOUT',
  'ADD_FAILED',
  'REMOVAL_BLOCKED',
  'REMOVE_TIMEOUT',
  'REMOVE_FAILED',
];

export type ResultCode = 'PASS' | 'FAIL' | 'BLOCKED' | 'TIMEOUT' | 'ERROR';
export type RemovalMethod = 'scan_replace' | 'scan_unmap' | 'cleanup_service' | 'none';

/** One row of the e2e_runs table. Timestamps are ISO strings so the row is plain JSON. */
export interface RunRow {
  runId: string;
  state: RunState;
  removalMethod: RemovalMethod;
  projectId: string;
  projectName: string;
  versionId: string;
  versionName: string;
  codeLocationId?: string;
  componentName: string;
  componentVersion: string;
  componentVersionId?: string;
  vulnIds: string[];
  controlComponent: string;
  controlVersion: string;
  addedAt: string;
  removedAt?: string;
  removeUploadedAt?: string;
  nextCheckAt: string;
  attempts: number;
  addResult?: ResultCode;
  removeResult?: ResultCode;
  svmAddSeenAt?: string;
  svmRemoveSeenAt?: string;
  evidence: Record<string, unknown>;
  notified?: boolean;
  updatedAt: string;
}
