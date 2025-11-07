import cds from '@sap/cds';
import type { Application, Request, Response, NextFunction } from 'express';

import apiKeyMiddleware/*, { loadApiKey } */from './middleware/apiKey';
import activeEmployeesHandler from './domain/employee/handlers/active-employees.read';

import { processOutbox } from './infrastructure/outbox/dispatcher';
import { cleanupOutbox } from './infrastructure/outbox/cleanup';
import {
  startNotificationOutboxScheduler,
  scheduledDispatch,
  purgeCompleted,
  shutdownDispatcher,
} from './domain/employee/services/notification-outbox.service';
import { resolveAuthProviderName } from './shared/utils/authProvider';
import { initializeLogger, getLogger, extractOrGenerateCorrelationId, setCorrelationId } from './shared/utils/logger';

let shutdownHooksRegistered = false;
const ensureShutdownHooks = (): void => {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;
  const outboxLogger = getLogger('outbox');
  const gracefulShutdown = async (): Promise<void> => {
    try {
      await shutdownDispatcher();
    } catch (error) {
      outboxLogger.error({ err: error }, 'Failed to shutdown notification dispatcher gracefully');
    }
  };

  cds.on('shutdown', () => {
    void gracefulShutdown();
  });

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.once(signal, () => {
      void gracefulShutdown().finally(() => {
        process.exit(0);
      });
    });
  }
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
    //auskommentiert für local dev
    //await loadApiKey();

    if (process.env.NODE_ENV === 'test') {
      return;
    }

    startNotificationOutboxScheduler();
    ensureShutdownHooks();

    void scheduledDispatch().catch((error) => {
      logger.warn({ err: error }, 'Initial outbox dispatch failed');
    });

    void purgeCompleted().catch((error) => {
      logger.warn({ err: error }, 'Initial outbox cleanup failed');
    });

    logger.info('All services started successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to complete service initialization');
    throw error; // Re-throw to signal initialization failure to CAP
  }
});

export { processOutbox, cleanupOutbox };
export default cds.server;
