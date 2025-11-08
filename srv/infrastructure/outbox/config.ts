import { parseCleanupCronInterval, resolvePositiveInt } from '../../shared/utils/environment';

export interface OutboxConfig {
  retryDelay: number;
  maxAttempts: number;
  batchSize: number;
  claimTtl: number;
  dispatcherWorkers: number;
  enqueueMaxAttempts: number;
  cleanupRetention: number;
  dispatchInterval: number;
  cleanupCron: string;
}

const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
  retryDelay: 60_000,
  maxAttempts: 5,
  batchSize: 20,
  claimTtl: 120_000,
  dispatcherWorkers: 4,
  enqueueMaxAttempts: 0,
  cleanupRetention: 7 * 24 * 60 * 60 * 1000,
  dispatchInterval: 30_000,
  cleanupCron: '0 * * * *',
};

const resolveNonNegativeInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  if (normalized < 0) {
    return fallback;
  }

  return normalized;
};

const resolveCleanupCron = (value: string | undefined, fallback: string): string => {
  if (!value || !value.trim()) {
    return fallback;
  }

  const trimmed = value.trim();
  const interval = parseCleanupCronInterval(trimmed);
  if (interval) {
    return trimmed;
  }

  return fallback;
};

export const loadOutboxConfig = (overrides: Partial<OutboxConfig> = {}): OutboxConfig => {
  const config: OutboxConfig = {
    retryDelay: resolvePositiveInt(process.env.OUTBOX_RETRY_DELAY_MS, DEFAULT_OUTBOX_CONFIG.retryDelay, 1000),
    maxAttempts: resolvePositiveInt(process.env.OUTBOX_MAX_ATTEMPTS, DEFAULT_OUTBOX_CONFIG.maxAttempts, 1),
    batchSize: resolvePositiveInt(process.env.OUTBOX_BATCH_SIZE, DEFAULT_OUTBOX_CONFIG.batchSize, 1),
    claimTtl: resolvePositiveInt(process.env.OUTBOX_CLAIM_TTL_MS, DEFAULT_OUTBOX_CONFIG.claimTtl, 1000),
    dispatcherWorkers: resolvePositiveInt(
      process.env.OUTBOX_DISPATCHER_WORKERS,
      DEFAULT_OUTBOX_CONFIG.dispatcherWorkers,
      1,
    ),
    enqueueMaxAttempts: resolveNonNegativeInt(
      process.env.OUTBOX_ENQUEUE_MAX_ATTEMPTS,
      DEFAULT_OUTBOX_CONFIG.enqueueMaxAttempts,
    ),
    cleanupRetention: resolveNonNegativeInt(
      process.env.OUTBOX_CLEANUP_RETENTION_MS,
      DEFAULT_OUTBOX_CONFIG.cleanupRetention,
    ),
    dispatchInterval: resolvePositiveInt(
      process.env.OUTBOX_DISPATCH_INTERVAL_MS,
      DEFAULT_OUTBOX_CONFIG.dispatchInterval,
      1000,
    ),
    cleanupCron: resolveCleanupCron(process.env.OUTBOX_CLEANUP_CRON, DEFAULT_OUTBOX_CONFIG.cleanupCron),
  };

  return { ...config, ...overrides };
};

export const defaultOutboxConfig = (): OutboxConfig => ({ ...DEFAULT_OUTBOX_CONFIG });
