'use strict';

/**
 * Lightweight main-process logger.
 * Prefer this over ad-hoc console.log so log format stays consistent.
 */

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function format(level, scope, message, extra) {
  const base = `[${stamp()}] [${level}] [${scope}] ${message}`;
  if (extra === undefined || extra === null) return base;
  if (typeof extra === 'string') return `${base} ${extra}`;
  try {
    return `${base} ${JSON.stringify(extra)}`;
  } catch {
    return `${base} ${String(extra)}`;
  }
}

function createLogger(scope) {
  return {
    info(message, extra) {
      console.log(format('INFO', scope, message, extra));
    },
    warn(message, extra) {
      console.warn(format('WARN', scope, message, extra));
    },
    error(message, extra) {
      console.error(format('ERROR', scope, message, extra));
    },
    debug(message, extra) {
      if (process.env.ECO_DEBUG === '1') {
        console.log(format('DEBUG', scope, message, extra));
      }
    }
  };
}

module.exports = { createLogger, format };
