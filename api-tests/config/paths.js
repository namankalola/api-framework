import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CACHE_DIR = path.join(ROOT, '.cache');
export const REPORT_DIR = path.join(ROOT, 'reports');
