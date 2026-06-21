import pino from 'pino';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

export const logger = {
  error: (message: string, ...args: unknown[]) => {
    if (args.length > 0) {
      pinoLogger.error({ err: args[0] }, message);
    } else {
      pinoLogger.error(message);
    }
  },
  warn: (message: string, ...args: unknown[]) => {
    if (args.length > 0) {
      pinoLogger.warn({ err: args[0] }, message);
    } else {
      pinoLogger.warn(message);
    }
  },
  info: (message: string, ...args: unknown[]) => {
    if (args.length > 0) {
      pinoLogger.info({ err: args[0] }, message);
    } else {
      pinoLogger.info(message);
    }
  },
  debug: (message: string, ...args: unknown[]) => {
    if (args.length > 0) {
      pinoLogger.debug({ err: args[0] }, message);
    } else {
      pinoLogger.debug(message);
    }
  },
  flush: (): Promise<void> => new Promise((resolve) => {
    pinoLogger.flush();
    resolve();
  }),
};
