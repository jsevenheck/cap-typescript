import { resolveCleanupInterval, resolveOutboxDispatchInterval } from '../../../infrastructure/outbox/config';
import { processOutbox } from '../../../infrastructure/outbox/dispatcher';
import { cleanupOutbox } from '../../../infrastructure/outbox/cleanup';
import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('employee-notification-outbox');

let dispatchTimer: NodeJS.Timeout | undefined;
let cleanupTimer: NodeJS.Timeout | undefined;
let dispatchInFlight: Promise<void> | undefined;
let cleanupInFlight: Promise<void> | undefined;
let shutdown = false;

const logAndRethrow = async <T>(operation: () => Promise<T>, message: string): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    logger.error({ err: error }, message);
    throw error;
  }
};

export const scheduledDispatch = async (): Promise<void> => {
  if (shutdown) {
    return;
  }

  if (!dispatchInFlight) {
    dispatchInFlight = logAndRethrow(processOutbox, 'Failed to dispatch employee notification outbox entries.')
      .finally(() => {
        dispatchInFlight = undefined;
      });
  }

  await dispatchInFlight;
};

export const purgeCompleted = async (): Promise<void> => {
  if (shutdown) {
    return;
  }

  if (!cleanupInFlight) {
    cleanupInFlight = logAndRethrow(cleanupOutbox, 'Failed to cleanup employee notification outbox entries.')
      .finally(() => {
        cleanupInFlight = undefined;
      });
  }

  await cleanupInFlight;
};

export const startNotificationOutboxScheduler = (): void => {
  if (shutdown) {
    shutdown = false;
  }

  if (dispatchTimer || cleanupTimer) {
    return;
  }

  const dispatchInterval = resolveOutboxDispatchInterval();
  dispatchTimer = setInterval(() => {
    void scheduledDispatch().catch(() => {
      // Errors are already logged inside scheduledDispatch.
    });
  }, dispatchInterval);

  const cleanupInterval = resolveCleanupInterval();
  if (cleanupInterval > 0) {
    cleanupTimer = setInterval(() => {
      void purgeCompleted().catch(() => {
        // Errors are already logged inside purgeCompleted.
      });
    }, cleanupInterval);
  }
};

export const shutdownDispatcher = async (): Promise<void> => {
  shutdown = true;

  if (dispatchTimer) {
    clearInterval(dispatchTimer);
    dispatchTimer = undefined;
  }

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }

  const pending: Promise<unknown>[] = [];
  if (dispatchInFlight) {
    pending.push(dispatchInFlight.catch(() => undefined));
  }

  if (cleanupInFlight) {
    pending.push(cleanupInFlight.catch(() => undefined));
  }

  if (pending.length) {
    await Promise.all(pending);
  }

  dispatchInFlight = undefined;
  cleanupInFlight = undefined;
};

export const getSchedulerState = (): {
  dispatchTimer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
} => ({ dispatchTimer, cleanupTimer });

export const resetNotificationDispatcher = (): void => {
  if (dispatchTimer) {
    clearInterval(dispatchTimer);
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  dispatchTimer = undefined;
  cleanupTimer = undefined;
  dispatchInFlight = undefined;
  cleanupInFlight = undefined;
  shutdown = false;
};
