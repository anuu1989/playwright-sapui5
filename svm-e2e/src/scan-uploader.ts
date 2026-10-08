import type { BdClient } from './bd-client';
import { InfraError } from './errors';

export interface UploadRequest {
  sbom: object;
  codeLocation: string;
  projectName: string;
  versionName: string;
}

export interface ScanUploader {
  upload(req: UploadRequest): Promise<void>;
}

/**
 * Uploads a CycloneDX SBOM to a named code location with mode=replace, so a second upload to the
 * same code location replaces its contents. The endpoint and query parameters differ between
 * Black Duck versions - confirm in your instance's /api-doc (Phase 0 spike) and adjust
 * `blackduck.sbom_upload_path` in config/settings.yaml. Detect can be used instead by
 * implementing ScanUploader around it.
 */
export class ApiScanUploader implements ScanUploader {
  constructor(
    private bd: BdClient,
    private uploadPath: string,
  ) {}

  async upload(req: UploadRequest): Promise<void> {
    const qs = new URLSearchParams({
      mode: 'replace',
      projectName: req.projectName,
      versionName: req.versionName,
      codeLocationName: req.codeLocation,
    });
    try {
      await this.bd.request(`${this.uploadPath}?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.cyclonedx+json' },
        body: JSON.stringify(req.sbom),
      });
    } catch (err) {
      if (err instanceof InfraError)
        throw new InfraError(err.status, `SBOM upload failed: ${err.message}`);
      throw err;
    }
  }
}
