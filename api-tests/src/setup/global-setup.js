import { getFramework } from '../framework.js';
import { TEST_ENV } from '../../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('setup');

/** Fail fast on bad config or specs, and warm the spec cache before workers start. */
export default async function globalSetup() {
  const { config, registry } = await getFramework();
  const summary = Object.entries(config.services)
    .map(([name, svc]) => `${name}: ${registry.list({ service: name }).length} operations @ ${svc.baseURL}`)
    .join('; ');
  log.info(`TEST_ENV=${TEST_ENV} DATA_SEED=${config.data.seed} | ${summary}`);
}
