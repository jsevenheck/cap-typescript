import { parseCleanupCronInterval, resolvePositiveInt } from '../../shared/utils/environment';

const DEFAULT_OUTBOX_TIMEOUT_MS = 15000;
const DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS = 30000;
const DEFAULT_OUTBOX_CLAIM_TTL_MS = 120000;
const DEFAULT_OUTBOX_MAX_ATTEMPTS = 6;
const DEFAULT_OUTBOX_BASE_BACKOFF_MS = 5000;
const DEFAULT_OUTBOX_CONCURRENCY = 1;
const DEFAULT_OUTBOX_RETENTION_HOURS = 168;
const DEFAULT_OUTBOX_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
