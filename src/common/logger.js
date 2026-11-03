const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

export function createLogger(name) {
  const out = (level, args) => {
    if (LEVELS[level] < threshold) return;
    const ts = new Date().toISOString().slice(11, 23);
    const line = `${ts} [${name}] ${level.toUpperCase()}`;
    (level === 'error' || level === 'warn' ? console.error : console.log)(line, ...args);
  };
  return {
    debug: (...a) => out('debug', a),
    info: (...a) => out('info', a),
    warn: (...a) => out('warn', a),
    error: (...a) => out('error', a),
  };
}
