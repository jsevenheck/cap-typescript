import cds from '@sap/cds';
import type { Application } from 'express';

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

  setInterval(async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      await processOutbox();
    } catch (error) {
      logger.error?.('Outbox processing failed:', error);
    } finally {
      running = false;
    }
  }, dispatchInterval);

  const cleanupInterval = resolveCleanupInterval();
  if (cleanupInterval > 0) {
    let cleanupRunning = false;

    setInterval(async () => {
      if (cleanupRunning) {
        return;
      }

      cleanupRunning = true;
      try {
        await cleanupOutbox();
      } catch (error) {
        logger.error?.('Outbox cleanup failed:', error);
      } finally {
        cleanupRunning = false;
      }
    }, cleanupInterval);
  }
});

export { processOutbox, cleanupOutbox };
export default cds.server;
