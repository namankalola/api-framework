/* eslint-disable no-empty-pattern -- Playwright fixtures require an object pattern even when unused */
import { test as base } from '@playwright/test';
import { getFramework } from '../framework.js';
import { Api } from '../core/api.js';
import { Cleanup } from '../core/cleanup.js';
import { SessionManager } from '../core/session-manager.js';
import { DataFactory, hashSeed } from '../data/data-factory.js';
import { ResourceResolver } from '../scenarios/resources.js';

/**
 * Import `test` and `expect` from here in every spec file:
 *   import { test, expect } from '../../src/fixtures/index.js';
 *
 * Fixtures:
 *   api       call operations by operationId (auth, logging, schema checks, cleanup built in)
 *   data      generate request bodies / params / negative cases from the spec
 *   cleanup   register extra teardown steps: cleanup.add('label', async () => { ... })
 *   resources real ids for {pathParams}: await resources.pathParams('getPetById') -> { petId: 123 }
 *   framework { config, registry, validator } for advanced use
 */
export const test = base.extend({
  framework: [async ({}, use) => use(await getFramework()), { scope: 'worker' }],

  sessions: [
    async ({ playwright, framework }, use) => {
      const sessions = new SessionManager({ playwright, config: framework.config });
      await use(sessions);
      await sessions.dispose();
    },
    { scope: 'worker' },
  ],

  cleanup: async ({}, use, testInfo) => {
    const cleanup = new Cleanup(testInfo);
    await use(cleanup);
    await cleanup.run();
  },

  data: async ({ framework }, use, testInfo) => {
    const runSeed = framework.config.data.seed;
    testInfo.annotations.push({ type: 'data seed', description: `DATA_SEED=${runSeed}` });
    await use(
      new DataFactory({
        registry: framework.registry,
        config: framework.config,
        seed: hashSeed(runSeed, testInfo.testId),
        workerIndex: testInfo.workerIndex,
      }),
    );
  },

  api: async ({ framework, sessions, cleanup }, use, testInfo) => {
    await use(new Api({ framework, sessions, cleanup, testInfo }));
  },

  resources: async ({ framework, api, data }, use) => {
    await use(new ResourceResolver({ registry: framework.registry, config: framework.config, api, data }));
  },
});

export { expect } from '../expect.js';
