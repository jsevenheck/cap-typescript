import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('request-timeout');

// Default timeout in milliseconds (30 seconds)
const DEFAULT_TIMEOUT = 30000;

// Maximum timeout in milliseconds (5 minutes)
const MAX_TIMEOUT = 300000;

/**
 * Request timeout configuration from environment
 */
function getRequestTimeout(): number {
  const envTimeout = process.env.REQUEST_TIMEOUT_MS;
  if (!envTimeout) {
    return DEFAULT_TIMEOUT;
  }

  const timeout = parseInt(envTimeout, 10);
  if (Number.isNaN(timeout) || timeout <= 0) {
    logger.warn({ envTimeout }, 'Invalid REQUEST_TIMEOUT_MS value, using default');
    return DEFAULT_TIMEOUT;
  }

  if (timeout > MAX_TIMEOUT) {
    logger.warn({ timeout, MAX_TIMEOUT }, 'REQUEST_TIMEOUT_MS exceeds maximum, capping to max');
    return MAX_TIMEOUT;
  }

  return timeout;
}

/**
 * Middleware to enforce request timeouts and prevent long-running operations
 * from consuming resources indefinitely.
 * 
 * SAP CAP Best Practice: Always set reasonable timeouts for HTTP requests
 * to prevent resource exhaustion and improve system resilience.
 * 
 * @param timeout - Optional timeout in milliseconds (defaults to environment or 30s)
 */
export function requestTimeoutMiddleware(timeout?: number): (req: Request, res: Response, next: NextFunction) => void {
  const timeoutMs = timeout ?? getRequestTimeout();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip timeout for health check endpoints
    if (req.path.startsWith('/health')) {
      next();
      return;
    }

    // Set timeout on the request
    req.setTimeout(timeoutMs, () => {
      if (res.headersSent) {
        // Response already sent, cannot send error
        logger.warn({ path: req.path, method: req.method, timeoutMs }, 'Request timed out after response sent');
        return;
      }

      logger.warn(
        {
          path: req.path,
          method: req.method,
          timeoutMs,
          correlationId: (req as { correlationId?: string }).correlationId,
        },
        'Request timeout exceeded',
      );

      res.status(408).json({
        error: 'Request Timeout',
        message: `Request exceeded the timeout of ${timeoutMs}ms`,
        code: 408,
      });
    });

    next();
  };
}

/**
 * Default export for convenient use
 */
export default requestTimeoutMiddleware;
