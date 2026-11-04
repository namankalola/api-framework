import config from '../../config/index.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = LEVELS[config.logging.level] ?? LEVELS.info;
function write(level, scope, args) {
  if (LEVELS[level] < threshold) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)}${scope ? ` [${scope}]` : ''}`;
  // stderr keeps stdout clean for machine-readable reporters (json, junit).
  console.error(prefix, ...args);
}

export const createLogger = (scope = '') => ({
  debug: (...args) => write('debug', scope, args),
  info: (...args) => write('info', scope, args),
  warn: (...args) => write('warn', scope, args),
  error: (...args) => write('error', scope, args),
});

export default createLogger();
