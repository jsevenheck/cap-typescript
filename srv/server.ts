import cds from '@sap/cds';
import type { Application } from 'express';
import { createHmac } from 'crypto';
import fetch, { type RequestInit } from 'node-fetch';

const { SELECT, UPDATE } = cds.ql;
const DELETE = (cds.ql as any).DELETE as any;

const DEFAULT_OUTBOX_TIMEOUT_MS = 15000;
const DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS = 30000;
const DEFAULT_OUTBOX_CLAIM_TTL_MS = 120000;
const DEFAULT_OUTBOX_MAX_ATTEMPTS = 6;
const DEFAULT_OUTBOX_BASE_BACKOFF_MS = 5000;
const DEFAULT_OUTBOX_CONCURRENCY = 1;
const DEFAULT_OUTBOX_RETENTION_HOURS = 168;
const DEFAULT_OUTBOX_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const resolveAuthProviderName = (): string => {
  const env = cds.env as any;
  const authConfig = env?.requires?.auth;
  const kind = typeof authConfig?.kind === 'string' ? authConfig.kind.toLowerCase() : undefined;

  if (kind === 'mocked') {
    return 'Mocked';
  }

  if (kind === 'ias' || kind === 'ias-auth' || kind === 'identity') {
    return 'IAS';
  }

  if (env?.security?.identity?.enabled) {
    return 'IAS';
  }

  return kind ?? 'Unknown';
};

const resolveOutboxTimeout = (): number => {
  const raw = process.env.THIRD_PARTY_EMPLOYEE_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_OUTBOX_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OUTBOX_TIMEOUT_MS;
  }

  return parsed;
};

const parsePositiveInt = (value: string | undefined, defaultValue: number, minimum = 1): number => {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const normalized = Math.floor(parsed);
  if (normalized < minimum) {
    return defaultValue;
  }

  return normalized;
};

const resolveOutboxDispatchInterval = (): number =>
  parsePositiveInt(process.env.OUTBOX_DISPATCH_INTERVAL_MS, DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS);

const resolveOutboxClaimTtl = (): number =>
  parsePositiveInt(process.env.OUTBOX_CLAIM_TTL_MS, DEFAULT_OUTBOX_CLAIM_TTL_MS);

const resolveOutboxMaxAttempts = (): number =>
  parsePositiveInt(process.env.OUTBOX_MAX_ATTEMPTS, DEFAULT_OUTBOX_MAX_ATTEMPTS);

const resolveOutboxBaseBackoff = (): number =>
  parsePositiveInt(process.env.OUTBOX_BASE_BACKOFF_MS, DEFAULT_OUTBOX_BASE_BACKOFF_MS);

const resolveOutboxConcurrency = (): number =>
  parsePositiveInt(process.env.OUTBOX_CONCURRENCY, DEFAULT_OUTBOX_CONCURRENCY);

const resolveOutboxRetentionHours = (): number => {
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

const parseCleanupCronInterval = (expression: string): number | undefined => {
  const trimmed = expression.trim();

  const minuteMatch = /^\*\/(\d+) \* \* \* \*$/.exec(trimmed);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }
  }

  const hourMatch = /^0 \*\/(\d+) \* \* \*$/.exec(trimmed);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (Number.isFinite(hours) && hours > 0) {
      return hours * 60 * 60 * 1000;
    }
  }

  return undefined;
};

const resolveCleanupInterval = (): number => {
  const cron = process.env.OUTBOX_CLEANUP_CRON;
  if (cron) {
    const cronInterval = parseCleanupCronInterval(cron);
    if (cronInterval) {
      return cronInterval;
    }
  }

  return parsePositiveInt(
    process.env.OUTBOX_CLEANUP_INTERVAL_MS,
    DEFAULT_OUTBOX_CLEANUP_INTERVAL_MS,
    1000,
  );
};

interface OutboxEntry {
  ID: string;
  endpoint: string;
  payload: string;
  status?: string;
  attempts?: number;
  nextAttemptAt?: Date | null;
}

export const processOutbox = async (): Promise<void> => {
  const db = (cds as any).db ?? (await cds.connect.to('db'));
  if (!db) {
    return;
  }

  const now = new Date();
  const nowTime = now.getTime();
  const claimTtlMs = resolveOutboxClaimTtl();
  const claimExpiryTime = nowTime - claimTtlMs;
  const concurrency = resolveOutboxConcurrency();
  const candidateLimit = Math.max(concurrency * 4, concurrency);

  const selectCandidates = (SELECT as any)
    .from('clientmgmt.EmployeeNotificationOutbox')
    .columns('ID', 'endpoint', 'payload', 'status', 'attempts', 'nextAttemptAt')
    .where({ status: { in: ['PENDING', 'PROCESSING'] } })
    .orderBy('nextAttemptAt')
    .limit(candidateLimit);

  const rawEntries = (await db.run(selectCandidates)) as OutboxEntry[];

  const claimable = rawEntries.filter((entry) => {
    const status = entry.status ?? 'PENDING';
    const nextAttemptAt = entry.nextAttemptAt
      ? new Date(entry.nextAttemptAt as unknown as string).getTime()
      : undefined;

    if (status === 'PENDING') {
      return !nextAttemptAt || nextAttemptAt <= nowTime;
    }

    if (status === 'PROCESSING') {
      return nextAttemptAt !== undefined && nextAttemptAt <= claimExpiryTime;
    }

    return false;
  });

  if (!claimable.length) {
    return;
  }

  const claimed: OutboxEntry[] = [];

  for (const entry of claimable) {
    if (claimed.length >= concurrency) {
      break;
    }

    const expectedStatus = entry.status === 'PROCESSING' ? 'PROCESSING' : 'PENDING';
    const claimResult = await db.run(
      UPDATE('clientmgmt.EmployeeNotificationOutbox')
        .set({ status: 'PROCESSING', nextAttemptAt: now })
        .where({ ID: entry.ID, status: expectedStatus }),
    );

    const claimedCount =
      typeof claimResult === 'number'
        ? claimResult
        : Array.isArray(claimResult)
        ? claimResult[0]
        : 0;

    if (!claimedCount) {
      continue;
    }

    claimed.push({
      ...entry,
      status: 'PROCESSING',
      attempts: entry.attempts ?? 0,
      nextAttemptAt: now,
    });
  }

  if (!claimed.length) {
    return;
  }

  const timeoutMs = resolveOutboxTimeout();
  const maxAttempts = resolveOutboxMaxAttempts();
  const baseBackoff = resolveOutboxBaseBackoff();

  await Promise.all(
    claimed.map(async (entry) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const secret = process.env.THIRD_PARTY_EMPLOYEE_SECRET;
      if (secret) {
        const signature = createHmac('sha256', secret).update(String(entry.payload ?? '')).digest('hex');
        headers['x-signature-sha256'] = signature;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(entry.endpoint, {
          method: 'POST',
          headers,
          body: entry.payload,
          signal: controller.signal,
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(`HTTP ${response.status} ${message}`.trim());
        }

        await db.run(
          UPDATE('clientmgmt.EmployeeNotificationOutbox')
            .set({
              status: 'COMPLETED',
              deliveredAt: new Date(),
              lastError: null,
              nextAttemptAt: null,
            })
            .where({ ID: entry.ID }),
        );
      } catch (error: any) {
        const attempts = (entry.attempts ?? 0) + 1;
        const backoff = Math.pow(2, attempts - 1) * baseBackoff;
        const nextAttemptAt = attempts >= maxAttempts ? null : new Date(Date.now() + backoff);

        await db.run(
          UPDATE('clientmgmt.EmployeeNotificationOutbox')
            .set({
              attempts,
              lastError: String(error?.message ?? error ?? 'Unknown error'),
              status: attempts >= maxAttempts ? 'FAILED' : 'PENDING',
              nextAttemptAt,
            })
            .where({ ID: entry.ID }),
        );
      } finally {
        clearTimeout(timeout);
      }
    }),
  );
};

const STATUSES_FOR_CLEANUP = ['COMPLETED', 'DELIVERED', 'FAILED'];

export const cleanupOutbox = async (): Promise<void> => {
  const db = (cds as any).db ?? (await cds.connect.to('db'));
  if (!db) {
    return;
  }

  const retentionHours = resolveOutboxRetentionHours();
  if (retentionHours <= 0) {
    return;
  }

  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

  await db.run(
    DELETE.from('clientmgmt.EmployeeNotificationOutbox').where({
      status: { in: STATUSES_FOR_CLEANUP },
      modifiedAt: { '<': cutoff },
    }),
  );
};

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

export default cds.server;
