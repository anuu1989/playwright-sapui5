import type { Locator, Page } from '@playwright/test';
import type { Settings } from '../../src/config';

/** Minimal stand-in for the team's existing SVM page object - replace with the real one. */
export class SvmAssetPage {
  constructor(
    private page: Page,
    private cfg: Settings,
  ) {}

  async open(projectName: string): Promise<void> {
    await this.page.goto(
      this.cfg.svm.ui_url +
        this.cfg.svm.asset_ui_path.replace('{project}', encodeURIComponent(projectName)),
    );
  }

  componentRow(name: string, version?: string): Locator {
    const row = this.page.getByRole('row').filter({ hasText: name });
    return version ? row.filter({ hasText: version }) : row;
  }
}
