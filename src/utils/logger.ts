import pino from 'pino';

/**
 * Structured logger using Pino
 * Provides JSON logging with levels, timestamps, and structured data
 */
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: process.env.NODE_ENV === 'development' 
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    pid: process.pid,
    service: 'n8n-daemon'
  }
});

export default logger;

/**
 * Create a child logger with additional context
 * @param context - Additional context to include in all log messages
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

