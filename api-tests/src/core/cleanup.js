import { createLogger } from '../utils/logger.js';

const log = createLogger('cleanup');

/** Test-scoped LIFO list of teardown actions. Failures are reported, never fail the test. */
export class Cleanup {
  constructor(testInfo) {
    this.testInfo = testInfo;
    this.tasks = [];
  }

  add(label, fn) {
    this.tasks.push({ label, fn });
  }

  async run() {
    for (const { label, fn } of this.tasks.reverse()) {
      try {
        await fn();
      } catch (error) {
        log.warn(`${label} failed: ${error.message}`);
        this.testInfo.annotations.push({ type: 'cleanup failed', description: `${label}: ${error.message}` });
      }
    }
    this.tasks = [];
  }
}
