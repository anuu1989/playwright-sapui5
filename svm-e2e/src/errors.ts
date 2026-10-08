/** A permission denied the step (401/403). Maps to the BLOCKED result code. */
export class BlockedError extends Error {
  constructor(
    public status: number,
    message = `Permission denied (${status})`,
  ) {
    super(message);
    this.name = 'BlockedError';
  }
}

/** Test infrastructure problem (network, expired token, unexpected response). Maps to ERROR. */
export class InfraError extends Error {
  constructor(
    public status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'InfraError';
  }
}

/** SVM shows the wrong data (wrong vulnerabilities, control component missing). Maps to FAIL. */
export class DataMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataMismatchError';
  }
}
