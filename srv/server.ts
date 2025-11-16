import cds from '@sap/cds';
import type { Application, Request, Response, NextFunction } from 'express';

import apiKeyMiddleware, { loadApiKey } from './middleware/apiKey';
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
  // Add correlation ID middleware to all routes
  app.use(correlationIdMiddleware);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/employees/active', apiKeyMiddleware, activeEmployeesHandler);

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
