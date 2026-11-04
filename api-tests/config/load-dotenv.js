// Side-effect module: must be imported before any config file reads process.env.
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from './paths.js';

const testEnv = process.env.TEST_ENV || 'dev';

// Earlier files win over later ones, and real env vars (CI secrets) always win over files.
dotenv.config({ path: path.join(ROOT, `.env.${testEnv}`), quiet: true });
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

// One seed per run, shared by all workers (they inherit this env), so any failure can be
// replayed with DATA_SEED=<seed> from the report annotations.
process.env.DATA_SEED ||= String(Math.floor(Math.random() * 2 ** 31));
