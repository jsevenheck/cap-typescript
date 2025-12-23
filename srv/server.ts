import cds from '@sap/cds';
import crypto from 'node:crypto';
import type { Application, Request, Response, NextFunction } from 'express';
import 'dotenv/config';

import apiKeyMiddleware, {
  forceReloadApiKey,
  isApiKeyValid,
  loadApiKey,
  readApiKeyFromRequest,
  getCachedApiKeySnapshot,
  startApiKeyRefreshScheduler,
  stopApiKeyRefreshScheduler,
} from './middleware/apiKey';
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
let activeEmployeesEndpointRegistered = false;
let expressAppInstance: Application | undefined;
const ensureShutdownHooks = (): void => {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;
  const stopRateLimiter = async (): Promise<void> => {
    const shutdown = (apiRateLimiter as typeof apiRateLimiter & { shutdown?: () => Promise<void> }).shutdown;
    if (typeof shutdown === 'function') {
      await shutdown();
    }
  };
  const stopScheduler = (): void => {
    outboxScheduler.stop();
    stopApiKeyRefreshScheduler();
  };
  cds.on('shutdown', () => {
    void stopRateLimiter();
    stopScheduler();
  });
  const gracefulStop = async (): Promise<void> => {
    await stopRateLimiter();
    stopScheduler();
  };
  const handleSignal = (): void => {
    void (async () => {
      await gracefulStop();
      process.exit(0);
    })();
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
};

// Initialize structured logger
initializeLogger();
const logger = getLogger('server');

logger.info({ odataUrlPath: (cds as any).env?.odata?.urlPath }, 'Effective CDS OData base path');

const wrapAsyncMiddleware = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): ((req: Request, res: Response, next: NextFunction) => void) => (
  req,
  res,
  next,
) => {
  Promise.resolve(handler(req, res, next)).catch((err: unknown) => next(err));
};

const registerActiveEmployeesEndpoint = (app: Application): void => {
  if (activeEmployeesEndpointRegistered) {
    return;
  }

  app.get(
    '/api/employees/active',
    wrapAsyncMiddleware(apiRateLimiter),
    apiKeyMiddleware,
    wrapAsyncMiddleware(activeEmployeesHandler),
  );
  const reloadToken = process.env.EMPLOYEE_EXPORT_API_RELOAD_TOKEN?.trim();
  const isReloadTokenAuthorized = (providedToken: string | undefined): boolean => {
    if (!reloadToken || !providedToken) {
      return false;
    }

    const providedBuffer = Buffer.from(providedToken, 'utf8');
    const reloadBuffer = Buffer.from(reloadToken, 'utf8');
    return providedBuffer.length === reloadBuffer.length && crypto.timingSafeEqual(providedBuffer, reloadBuffer);
  };

  app.post('/api/employees/active/reload-key', wrapAsyncMiddleware(apiRateLimiter), wrapAsyncMiddleware(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const providedReloadToken = req.header('x-reload-token')?.trim();
    const providedApiKey = readApiKeyFromRequest(req);
    const cachedApiKey = getCachedApiKeySnapshot();

    const authorizedByToken = isReloadTokenAuthorized(providedReloadToken);
    const authorizedByApiKey = Boolean(cachedApiKey && isApiKeyValid(providedApiKey, cachedApiKey));

    if (!authorizedByToken && !authorizedByApiKey) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const reloadResult = await forceReloadApiKey();
      if (!reloadResult.loaded) {
        logger.warn({ reloadResult }, 'Failed to force reload employee export API key');
      }

      // NOTE: forceReloadApiKey returns { loaded, rotated, source }; expose `loaded` as `reloaded` to reflect this endpoint's action.
      res
        .status(reloadResult.loaded ? 200 : 503)
        .json({ reloaded: reloadResult.loaded, rotated: reloadResult.rotated });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to force reload employee export API key');
      res.status(500).json({ error: 'reload_failed' });
    }
  }));
  activeEmployeesEndpointRegistered = true;
  logger.info('Registered /api/employees/active and /api/employees/active/reload-key endpoints with API key protection');
};

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
  expressAppInstance = app;

  // Respect X-Forwarded-* headers when behind a reverse proxy (e.g., approuter)
  app.set('trust proxy', true);

  const odataUrlPath = (cds.env as any)?.odata?.urlPath as string | undefined;

  // Alias the service under the configured OData base path (e.g., /odata/v4) so
  // consumers hitting the documented URL continue to work even if cds-serve falls
  // back to mounting services at the root path.
  if (odataUrlPath && odataUrlPath !== '/') {
    const normalizedPath = odataUrlPath.endsWith('/') && odataUrlPath.length > 1
      ? odataUrlPath.slice(0, -1)
      : odataUrlPath;

    logger.info({ path: normalizedPath }, 'Configuring OData base path alias');

    app.use(normalizedPath, (req, res, next) => {
      if ((req as any)._odataAliasApplied) {
        next();
        return;
      }

      const suffix = req.originalUrl.substring(normalizedPath.length);
      (req as any)._odataAliasApplied = true;
      req.url = suffix.startsWith('/') ? suffix : `/${suffix}`;

      // Debug log to verify aliasing in case the framework mounts services without the configured base path
      logger.debug({ originalUrl: req.originalUrl, rewrittenUrl: req.url }, 'Rewriting OData request to base path');

      (app as any).handle(req, res, next);
    });

    logger.info({ path: normalizedPath }, 'Mounted OData alias');
  }

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
    const apiKeyLoaded = await loadApiKey();

    if (!apiKeyLoaded.loaded) {
      logger.error(
        'EMPLOYEE_EXPORT_API_KEY missing - skipping /api/employees/active endpoint registration. Bind Credential Store or set the environment variable before starting the service.',
      );
    } else if (expressAppInstance) {
      registerActiveEmployeesEndpoint(expressAppInstance);
    } else {
      logger.warn('Express application instance not available; cannot register /api/employees/active endpoint');
    }

    startApiKeyRefreshScheduler();
    // Trigger an immediate refresh so the scheduler has a warm baseline and failures are surfaced early.
    await forceReloadApiKey();

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

// Ensure CAP runtime can detect the server when loaded via CommonJS
module.exports = cds.server;

// When executed directly (e.g., via `node dist/server.js`), start the CAP server
if (require.main === module) {
  void (async () => {
    try {
      await cds.server;
      logger.info('CAP server started via direct execution');
    } catch (error) {
      logger.error({ err: error }, 'Failed to start CAP server');
      process.exitCode = 1;
    }
  })();
}
