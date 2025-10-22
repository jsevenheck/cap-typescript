import cds from '@sap/cds';
import type { Application, Request, Response, NextFunction } from 'express';

import apiKeyMiddleware, { loadApiKey } from './middleware/apiKey';
import activeEmployeesHandler from './domain/employee/handlers/active-employees.read';

import { processOutbox } from './infrastructure/outbox/dispatcher';
import { cleanupOutbox } from './infrastructure/outbox/cleanup';
import { scheduleOutboxCleanup, scheduleOutboxProcessing } from './infrastructure/outbox/scheduler';
import { resolveAuthProviderName } from './shared/utils/authProvider';
import { initializeLogger, getLogger, extractOrGenerateCorrelationId, setCorrelationId } from './shared/utils/logger';

const outboxTimers: NodeJS.Timeout[] = [];

const registerTimer = (timer?: NodeJS.Timeout): void => {
  if (timer) {
    outboxTimers.push(timer);
  }
};

const clearOutboxTimers = (): void => {
  while (outboxTimers.length) {
    const timer = outboxTimers.pop();
    if (timer) {
      clearInterval(timer);
    }
  }
};

let shutdownHooksRegistered = false;
const ensureShutdownHooks = (): void => {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;
  cds.on('shutdown', clearOutboxTimers);
  process.on('exit', clearOutboxTimers);
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

cds.on('served', () => {
  const authLogger = getLogger('auth');
  authLogger.info(`Authentication provider: ${resolveAuthProviderName()}`);

  // Load API key from Credential Store or environment (async but not awaited)
  void loadApiKey();

  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const outboxLogger = getLogger('outbox');
  registerTimer(scheduleOutboxProcessing(processOutbox, outboxLogger));
  registerTimer(scheduleOutboxCleanup(cleanupOutbox, outboxLogger));
  ensureShutdownHooks();

  logger.info('All services started successfully');
});

export { processOutbox, cleanupOutbox };
export default cds.server;
