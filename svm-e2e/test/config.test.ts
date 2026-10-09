import { afterEach, describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config';

const keys = ['BD_URL', 'SVM_API_URL', 'SVM_UI_URL'];
afterEach(() => keys.forEach((k) => delete process.env[k]));

describe('loadSettings URL overrides', () => {
  it('uses the YAML values by default', () => {
    expect(loadSettings().blackduck.url).toBe('https://verint.app.blackduck.com');
  });
  it('lets env vars override the URLs and strips trailing slashes', () => {
    process.env.BD_URL = 'https://blackduck.corp.internal:8443/';
    process.env.SVM_API_URL = 'https://svm-api.corp.internal';
    process.env.SVM_UI_URL = 'https://svm.corp.internal';
    const s = loadSettings();
    expect(s.blackduck.url).toBe('https://blackduck.corp.internal:8443');
    expect(s.svm.api_url).toBe('https://svm-api.corp.internal');
    expect(s.svm.ui_url).toBe('https://svm.corp.internal');
  });
});
