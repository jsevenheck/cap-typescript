import { resolveCleanupInterval, resolveOutboxDispatchInterval } from './config';

export type Logger = { error?: (...args: unknown[]) => void } & Record<string, unknown>;

export const scheduleOutboxProcessing = (
  processor: () => Promise<void>,
  logger: Logger,
): NodeJS.Timeout => {
  let running = false;
  const dispatchInterval = resolveOutboxDispatchInterval();

  return setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    void processor()
      .catch((error) => {
        logger.error?.('Outbox processing failed:', error);
      })
      .finally(() => {
        running = false;
      });
  }, dispatchInterval);
};

export const scheduleOutboxCleanup = (
  cleanup: () => Promise<void>,
  logger: Logger,
): NodeJS.Timeout | undefined => {
  const cleanupInterval = resolveCleanupInterval();
  if (cleanupInterval <= 0) {
    return undefined;
  }

  let running = false;

  return setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    void cleanup()
      .catch((error) => {
        logger.error?.('Outbox cleanup failed:', error);
      })
      .finally(() => {
        running = false;
      });
  }, cleanupInterval);
};
