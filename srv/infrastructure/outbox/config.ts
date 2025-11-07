import { parseCleanupCronInterval, resolvePositiveInt } from '../../shared/utils/environment';

const DEFAULT_OUTBOX_TIMEOUT_MS = 15000;
const DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS = 30000;
const DEFAULT_OUTBOX_CLAIM_TTL_MS = 120000;
const DEFAULT_OUTBOX_MAX_ATTEMPTS = 6;
const DEFAULT_OUTBOX_BASE_BACKOFF_MS = 5000;
const DEFAULT_OUTBOX_CONCURRENCY = 1;
const DEFAULT_OUTBOX_RETENTION_HOURS = 168;
const DEFAULT_OUTBOX_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_OUTBOX_BATCH_SIZE = 20;
const DEFAULT_OUTBOX_DISPATCHER_WORKERS = 4;
const DEFAULT_OUTBOX_ENQUEUE_MAX_ATTEMPTS = 0; // 0 = unlimited

export const resolveOutboxTimeout = (): number =>
  resolvePositiveInt(process.env.OUTBOX_TIMEOUT_MS, DEFAULT_OUTBOX_TIMEOUT_MS);

export const resolveOutboxDispatchInterval = (): number =>
  resolvePositiveInt(process.env.OUTBOX_DISPATCH_INTERVAL_MS, DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS);

export const resolveOutboxClaimTtl = (): number =>
  resolvePositiveInt(process.env.OUTBOX_CLAIM_TTL_MS, DEFAULT_OUTBOX_CLAIM_TTL_MS);

export const resolveOutboxMaxAttempts = (): number =>
  resolvePositiveInt(process.env.OUTBOX_MAX_ATTEMPTS, DEFAULT_OUTBOX_MAX_ATTEMPTS);

export const resolveOutboxBaseBackoff = (): number =>
  resolvePositiveInt(process.env.OUTBOX_BASE_BACKOFF_MS, DEFAULT_OUTBOX_BASE_BACKOFF_MS);

export const resolveOutboxConcurrency = (): number =>
  resolvePositiveInt(process.env.OUTBOX_CONCURRENCY, DEFAULT_OUTBOX_CONCURRENCY);

export const resolveOutboxRetentionHours = (): number => {
  const raw = process.env.OUTBOX_RETENTION_HOURS;
  if (!raw) {
    return DEFAULT_OUTBOX_RETENTION_HOURS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_OUTBOX_RETENTION_HOURS;
  }

  return Math.floor(parsed);
};

export const resolveCleanupInterval = (): number => {
  const cron = process.env.OUTBOX_CLEANUP_CRON;
  if (cron) {
    const cronInterval = parseCleanupCronInterval(cron);
    if (cronInterval) {
      return cronInterval;
    }
  }

  return resolvePositiveInt(process.env.OUTBOX_CLEANUP_INTERVAL_MS, DEFAULT_OUTBOX_CLEANUP_INTERVAL_MS, 1000);
};

export const resolveOutboxBatchSize = (): number =>
  resolvePositiveInt(process.env.OUTBOX_BATCH_SIZE, DEFAULT_OUTBOX_BATCH_SIZE);

export const resolveOutboxDispatcherWorkers = (): number =>
  resolvePositiveInt(process.env.OUTBOX_DISPATCHER_WORKERS, DEFAULT_OUTBOX_DISPATCHER_WORKERS);

export const resolveOutboxEnqueueMaxAttempts = (): number => {
  const raw = process.env.OUTBOX_ENQUEUE_MAX_ATTEMPTS;
  if (!raw) {
    return DEFAULT_OUTBOX_ENQUEUE_MAX_ATTEMPTS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_OUTBOX_ENQUEUE_MAX_ATTEMPTS;
  }

  return Math.floor(parsed);
};

/**
 * Outbox configuration interface for external consumers
 */
export interface OutboxConfig {
  retryDelay: number;           // Base retry delay in ms
  maxAttempts: number;          // Max delivery attempts
  batchSize: number;            // Batch size for processing
  claimTtl: number;             // Claim TTL in ms
  dispatcherWorkers: number;    // Parallel workers
  enqueueMaxAttempts: number;   // Max enqueue retry attempts (0 = unlimited)
  cleanupRetention: number;     // Retention period in hours
  dispatchInterval: number;     // Dispatch interval in ms
  timeout: number;              // Request timeout in ms
}

/**
 * Get complete outbox configuration
 */
export const getOutboxConfig = (): OutboxConfig => ({
  retryDelay: resolveOutboxBaseBackoff(),
  maxAttempts: resolveOutboxMaxAttempts(),
  batchSize: resolveOutboxBatchSize(),
  claimTtl: resolveOutboxClaimTtl(),
  dispatcherWorkers: resolveOutboxDispatcherWorkers(),
  enqueueMaxAttempts: resolveOutboxEnqueueMaxAttempts(),
  cleanupRetention: resolveOutboxRetentionHours(),
  dispatchInterval: resolveOutboxDispatchInterval(),
  timeout: resolveOutboxTimeout(),
});
