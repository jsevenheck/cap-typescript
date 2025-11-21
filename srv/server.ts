import cds from '@sap/cds';
import type { Application, Request, Response, NextFunction } from 'express';

import apiKeyMiddleware, { loadApiKey } from './middleware/apiKey';
import { apiRateLimiter } from './middleware/rateLimit';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import activeEmployeesHandler from './domain/employee/handlers/active-employees.read';

import {
  outboxCleanup,
  outboxDispatcher,
  outboxScheduler,
} from './infrastructure/outbox';
import { resolveAuthProviderName } from './shared/utils/authProvider';
import { initializeLogger, getLogger, extractOrGenerateCorrelationId, setCorrelationId } from './shared/utils/logger';

let shutdownHooksRegistered = false;
const ensureShutdownHooks = (): void => {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;
  const stopScheduler = (): void => {
    outboxScheduler.stop();
  };
  cds.on('shutdown', stopScheduler);
  process.on('exit', stopScheduler);
};

// Initialize structured logger
initializeLogger();
const logger = getLogger('server');

/**
 * Correlation ID middleware - adds x-correlation-id to all requests
 */
const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const correlationId = extractOrGenerateCorrelationId(req.headers as Record<string, string | string[] | undefined>);
  (req as any).correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  setCorrelationId(correlationId);
  next();
};

cds.on('bootstrap', (app: Application) => {
  // Add security headers to all responses
  app.use(securityHeadersMiddleware);

  // Add correlation ID middleware to all routes
  app.use(correlationIdMiddleware);

  /**
   * Health check endpoint - verifies application and database connectivity
   * Returns 200 OK if healthy, 503 Service Unavailable if unhealthy
   */
  app.get('/health', (_req, res) => {
    // Wrap async logic to satisfy @typescript-eslint/no-misused-promises
    void (async () => {
      try {
        // Verify database connectivity by attempting a simple query
        const db = (cds as any).db ?? (await cds.connect.to('db'));

        if (!db) {
          throw new Error('Database connection not available');
        }

        // Simple connectivity test - query for any client (limit 1)
        const { SELECT } = cds.ql;
        await db.run(SELECT.one.from('clientmgmt.Clients').columns('ID'));

        res.status(200).json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          checks: {
            database: 'connected',
          },
        });
      } catch (error) {
        logger.error({ err: error }, 'Health check failed');
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          checks: {
            database: 'disconnected',
          },
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })();
  });

  // Public API endpoint with rate limiting and API key authentication
  // Rate limiter runs first to prevent brute-force API key attacks
  app.get('/api/employees/active', apiRateLimiter, apiKeyMiddleware, activeEmployeesHandler);

  logger.info('Application bootstrap complete');
});

// CAP framework supports async event handlers and waits for them to complete.
// This is essential for proper initialization before the server accepts requests.
// eslint-disable-next-line @typescript-eslint/no-misused-promises
cds.on('served', async () => {
  try {
    const authLogger = getLogger('auth');
    authLogger.info(`Authentication provider: ${resolveAuthProviderName()}`);

    // Load API key from Credential Store or environment before accepting requests
    await loadApiKey();

    if (process.env.NODE_ENV === 'test') {
      return;
    }

    outboxScheduler.start();
    ensureShutdownHooks();

    logger.info('All services started successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to complete service initialization');
    throw error; // Re-throw to signal initialization failure to CAP
  }
});

export const dispatchOutboxOnce = (): Promise<void> => outboxDispatcher.dispatchPending();
export const cleanupOutboxOnce = (): Promise<void> => outboxCleanup.run();
export default cds.server;
