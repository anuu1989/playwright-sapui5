import type { Page } from '@playwright/test';
import type { Ui5Target } from './Ui5Bridge';
import * as fs from 'node:fs/promises';

export interface Ui5DownloadResult {
  /** The filename the browser would have saved this as - `download.suggestedFilename()`. */
  suggestedFilename: string;
  /** The downloaded file's raw bytes. */
  buffer: Buffer;
  byteLength: number;
  /**
   * Whether `buffer` starts with a ZIP local-file-header signature (`PK\x03\x04`, or the
   * empty-archive form `PK\x05\x06`). **Only a magic-byte check** - it does not open the archive
   * or confirm it's specifically an XLSX (vs. any other ZIP-based format). Named for the common
   * case anyway: SAPUI5's own `sap.ui.export.Spreadsheet` (what a real Fiori "Export to
   * Spreadsheet"/"Export to Excel" button triggers) produces a real XLSX - a ZIP archive - by
   * default, so this is the practical signal a test actually wants: "did a real spreadsheet file
   * come back, not an HTML error page or an empty response".
   */
  looksLikeXlsx: boolean;
}

/**
 * Capturing the file a SAPUI5 "Export to Spreadsheet"/"Export to Excel" button produces - the
 * download Playwright's own `Download` API already models, wrapped to fix the one race everyone
 * hits with it and to read the file back as bytes in one call. See docs/export.md.
 *
 * The trap this avoids: `page.waitForEvent('download')` has to be **registered before** the click
 * that triggers it, or the event can fire and be missed entirely - `captureDownload()` takes the
 * triggering action as a callback specifically so it can start listening first, run the trigger,
 * then await both, instead of leaving that ordering up to every call site.
 *
 * ```ts
 * const file = await Ui5Export.captureDownload(page, () =>
 *   ui5(page).id('export-internalSplitBtn-textButton').click(),
 * );
 * expect(file.looksLikeXlsx).toBe(true);
 * ```
 *
 * Deliberately doesn't try to locate the export trigger itself - which control it is, and how to
 * find it, varies by app (see docs/export.md#finding-the-trigger) - `trigger` is just "the action
 * that starts the download", using whatever locator your app needs.
 */
export class Ui5Export {
  static async captureDownload(
    target: Ui5Target,
    trigger: () => Promise<void>,
    options: { timeout?: number } = {},
  ): Promise<Ui5DownloadResult> {
    const page = ownerPage(target);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: options.timeout ?? 30000 }),
      trigger(),
    ]);

    // download.path() *rejects* (it doesn't resolve to null) when the download failed or was
    // canceled partway through - verified directly, not assumed from Playwright's own docs.
    let path: string | null;
    try {
      path = await download.path();
    } catch {
      path = null;
    }
    if (!path) {
      const failure = await download.failure();
      throw new Error(
        `[playwright-sapui5] Ui5Export.captureDownload: the download of "${download.suggestedFilename()}" ` +
          `never produced a local file (failed or was canceled partway through)${failure ? `: ${failure}` : ''}.`,
      );
    }
    const buffer = await fs.readFile(path);
    return {
      suggestedFilename: download.suggestedFilename(),
      buffer,
      byteLength: buffer.length,
      looksLikeXlsx: isZipSignature(buffer),
    };
  }
}

function ownerPage(target: Ui5Target): Page {
  return 'page' in target ? target.page() : target;
}

function isZipSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  // Local file header ('PK\x03\x04') - a normal, non-empty ZIP. End-of-central-directory
  // ('PK\x05\x06') - technically a valid, empty ZIP, included for completeness even though a real
  // spreadsheet export is never actually empty.
  const isLocalFileHeader =
    buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const isEmptyArchive =
    buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x05 && buffer[3] === 0x06;
  return isLocalFileHeader || isEmptyArchive;
}
