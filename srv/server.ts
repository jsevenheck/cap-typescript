import cds from '@sap/cds';
import type { Application } from 'express';

import apiKeyMiddleware from './middleware/apiKey';
import activeEmployeesHandler from './domain/employee/handlers/active-employees.read';

import { processOutbox } from './infrastructure/outbox/dispatcher';
import { cleanupOutbox } from './infrastructure/outbox/cleanup';
import { scheduleOutboxCleanup, scheduleOutboxProcessing } from './infrastructure/outbox/scheduler';
import { resolveAuthProviderName } from './shared/utils/authProvider';

cds.on('bootstrap', (app: Application) => {
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/employees/active', apiKeyMiddleware, activeEmployeesHandler);
});

cds.on('served', () => {
  const authLogger = (cds as any).log?.('auth') ?? console;
  authLogger.info?.(`Authentication provider: ${resolveAuthProviderName()}`);

  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const logger = (cds as any).log?.('outbox') ?? console;
  scheduleOutboxProcessing(processOutbox, logger);
  scheduleOutboxCleanup(cleanupOutbox, logger);
});

export { processOutbox, cleanupOutbox };
export default cds.server;
