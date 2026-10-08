import { readFileSync } from 'node:fs';
import { DUE_FILE } from './global-setup';
import { registerChecks } from './phase';

registerChecks('remove', JSON.parse(readFileSync(DUE_FILE, 'utf8')).remove);
