import cds from '@sap/cds';
import type { Application } from 'express';

import apiKeyMiddleware from './middleware/apiKey';
import activeEmployeesHandler from './handlers/activeEmployees';

import {
  cleanupOutbox,
  processOutbox,
  resolveCleanupInterval,
  resolveOutboxDispatchInterval,
} from './services/OutboxService';
import { resolveAuthProviderName } from './utils/authProvider';

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
  let running = false;
  const dispatchInterval = resolveOutboxDispatchInterval();

  setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    void processOutbox()
      .catch((error) => {
        logger.error?.('Outbox processing failed:', error);
      })
      .finally(() => {
        running = false;
      });
  }, dispatchInterval);

  const cleanupInterval = resolveCleanupInterval();
  if (cleanupInterval > 0) {
    let cleanupRunning = false;

    setInterval(() => {
      if (cleanupRunning) {
        return;
      }

      cleanupRunning = true;
      void cleanupOutbox()
        .catch((error) => {
          logger.error?.('Outbox cleanup failed:', error);
        })
        .finally(() => {
          cleanupRunning = false;
        });
    }, cleanupInterval);
  }
});

export { processOutbox, cleanupOutbox };
export default cds.server;
