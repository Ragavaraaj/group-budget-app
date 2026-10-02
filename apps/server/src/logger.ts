import type { Config } from './config';

export type LogLevel = Config['LOG_LEVEL'];

export interface Logger {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** Errors don't survive JSON.stringify; flatten them so they show up in Workers Logs. */
function serialise(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value,
    ]),
  );
}

/** One JSON object per line on the console; Workers Logs indexes the fields. */
export function createLogger(level: LogLevel): Logger {
  const emit =
    (name: Exclude<LogLevel, 'silent'>) => (fields: Record<string, unknown>, message: string) => {
      if (rank[name] < rank[level]) return;
      console[name](JSON.stringify({ level: name, message, ...serialise(fields) }));
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
