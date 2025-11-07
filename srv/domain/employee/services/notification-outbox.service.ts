/**
 * Employee notification outbox service.
 * Provides domain-level interface for managing employee notification outbox operations.
 */

import { processOutbox } from '../../../infrastructure/outbox/dispatcher';
import { cleanupOutbox } from '../../../infrastructure/outbox/cleanup';

/**
 * Dispatches pending notification items from the outbox.
 * This processes all PENDING and stale PROCESSING items,
 * attempting to deliver them to their configured destinations.
 *
 * @returns Promise that resolves when dispatch cycle completes
 */
export const scheduledDispatch = async (): Promise<void> => {
  await processOutbox();
};

/**
 * Purges completed notification items from the outbox.
 * Removes COMPLETED entries that have been successfully delivered
 * to free up database space and improve query performance.
 *
 * @returns Promise that resolves when purge completes
 */
export const purgeCompleted = async (): Promise<void> => {
  await cleanupOutbox();
};

/**
 * Shuts down the notification dispatcher gracefully.
 * Currently a no-op as the dispatcher is managed by the server's
 * timer registry and shutdown hooks. This function is provided
 * for API completeness and future extensibility.
 *
 * @returns Promise that resolves immediately
 */
export const shutdownDispatcher = async (): Promise<void> => {
  // Timer cleanup is handled by server.ts shutdown hooks
  // This is a placeholder for any future dispatcher-specific cleanup
  return Promise.resolve();
};
