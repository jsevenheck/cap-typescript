// Type-safe wrapper around @sap/logging
// Note: @sap/logging doesn't have TypeScript definitions, so we define our own interface

let createLoggerFunc: ((config: { appName: string; appVersion: string }) => any) | null = null;

try {
  // Try to import @sap/logging if available
  const logging = require('@sap/logging');
  createLoggerFunc = logging.createLogger;
} catch {
  // @sap/logging not available (likely in test or development)
  createLoggerFunc = null;
}

export interface Logger extends Record<string, unknown> {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  createChild?: (context: Record<string, unknown>) => Logger;
  setCorrelationId?: (id: string) => void;
}

let applicationLogger: Logger | null = null;

/**
 * Initialize the application-wide structured logger.
 * Should be called once during application bootstrap.
 */
export const initializeLogger = (): void => {
  try {
    if (createLoggerFunc) {
      applicationLogger = createLoggerFunc({
        appName: 'cap-ts-hr',
        appVersion: '1.0.0',
      }) as Logger;
    }
  } catch (error) {
    // Fallback to console if @sap/logging initialization fails
    console.warn('Failed to initialize @sap/logging, falling back to console:', error);
    applicationLogger = null;
  }
};

/**
 * Get a structured logger for a specific component.
 * Falls back to console if @sap/logging is not available.
 */
export const getLogger = (component: string): Logger => {
  if (applicationLogger && typeof applicationLogger.createChild === 'function') {
    return applicationLogger.createChild({ component });
  }

  // Fallback to console-based logger
  return {
    info: (...args: unknown[]) => console.info(`[${component}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${component}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${component}]`, ...args),
    debug: (...args: unknown[]) => console.debug(`[${component}]`, ...args),
    trace: (...args: unknown[]) => console.trace(`[${component}]`, ...args),
  };
};

/**
 * Set correlation ID for the current request context.
 * This allows tracing requests across distributed systems.
 */
export const setCorrelationId = (correlationId: string): void => {
  if (applicationLogger && typeof applicationLogger.setCorrelationId === 'function') {
    applicationLogger.setCorrelationId(correlationId);
  }
};

/**
 * Get or generate a correlation ID from a request object.
 */
export const extractOrGenerateCorrelationId = (headers: Record<string, string | string[] | undefined>): string => {
  const existing = headers['x-correlation-id'] || headers['x-correlationid'] || headers['x-request-id'];

  if (typeof existing === 'string') {
    return existing;
  }

  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0];
  }

  // Generate new UUID v4
  return crypto.randomUUID();
};
