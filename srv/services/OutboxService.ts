/**
 * Orchestrates the employee notification outbox pipeline.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { postEmployeeNotification } from '../api/ThirdPartyEmployeeClient';
import { parseCleanupCronInterval, resolvePositiveInt } from '../utils/environment';

const SELECT = (cds.ql.SELECT as any).bind(cds.ql) as typeof cds.ql.SELECT;
const UPDATE = (cds.ql.UPDATE as any).bind(cds.ql) as typeof cds.ql.UPDATE;
const DELETE = ((cds.ql as any).DELETE as any).bind(cds.ql);
const INSERT = ((cds.ql as any).INSERT as any).bind(cds.ql);

const DEFAULT_OUTBOX_TIMEOUT_MS = 15000;
const DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS = 30000;
const DEFAULT_OUTBOX_CLAIM_TTL_MS = 120000;
const DEFAULT_OUTBOX_MAX_ATTEMPTS = 6;
const DEFAULT_OUTBOX_BASE_BACKOFF_MS = 5000;
const DEFAULT_OUTBOX_CONCURRENCY = 1;
const DEFAULT_OUTBOX_RETENTION_HOURS = 168;
const DEFAULT_OUTBOX_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const resolveOutboxTimeout = (): number =>
  resolvePositiveInt(process.env.THIRD_PARTY_EMPLOYEE_TIMEOUT_MS, DEFAULT_OUTBOX_TIMEOUT_MS);

export const resolveOutboxDispatchInterval = (): number =>
  resolvePositiveInt(process.env.OUTBOX_DISPATCH_INTERVAL_MS, DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS);

const resolveOutboxClaimTtl = (): number =>
  resolvePositiveInt(process.env.OUTBOX_CLAIM_TTL_MS, DEFAULT_OUTBOX_CLAIM_TTL_MS);

const resolveOutboxMaxAttempts = (): number =>
  resolvePositiveInt(process.env.OUTBOX_MAX_ATTEMPTS, DEFAULT_OUTBOX_MAX_ATTEMPTS);

const resolveOutboxBaseBackoff = (): number =>
  resolvePositiveInt(process.env.OUTBOX_BASE_BACKOFF_MS, DEFAULT_OUTBOX_BASE_BACKOFF_MS);

const resolveOutboxConcurrency = (): number =>
  resolvePositiveInt(process.env.OUTBOX_CONCURRENCY, DEFAULT_OUTBOX_CONCURRENCY);

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
    const originalNextAttemptAt =
      entry.nextAttemptAt === null || entry.nextAttemptAt === undefined ? null : entry.nextAttemptAt;

    const where: Record<string, unknown> = {
      ID: entry.ID,
      status: expectedStatus,
    };

    if (originalNextAttemptAt === null) {
      where.nextAttemptAt = null;
    } else {
      where.nextAttemptAt = originalNextAttemptAt;
    }

    const claimResult = await db.run(
      UPDATE('clientmgmt.EmployeeNotificationOutbox')
        .set({ status: 'PROCESSING', nextAttemptAt: now })
        .where(where),
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
  const secret = process.env.THIRD_PARTY_EMPLOYEE_SECRET;

  await Promise.all(
    claimed.map(async (entry) => {
      try {
        await postEmployeeNotification({
          endpoint: entry.endpoint,
          payload: entry.payload,
          secret: secret ?? undefined,
          timeoutMs,
        });

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

export interface EmployeeCreatedNotification {
  endpoint: string;
  payload: Record<string, unknown>;
}

export const enqueueEmployeeCreatedNotification = async (
  tx: Transaction,
  notification: EmployeeCreatedNotification,
): Promise<void> => {
  await tx.run(
    INSERT.into('clientmgmt.EmployeeNotificationOutbox').entries({
      eventType: 'EMPLOYEE_CREATED',
      endpoint: notification.endpoint,
      payload: JSON.stringify(notification.payload),
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
    }),
  );
};
