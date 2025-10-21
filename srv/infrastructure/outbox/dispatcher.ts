import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { getDestination, type HttpDestination } from '@sap-cloud-sdk/connectivity';
import { circuitBreaker, timeout, wrap, handleAll, ConsecutiveBreaker, TimeoutStrategy } from 'cockatiel';

import { postEmployeeNotification } from '../api/third-party/employee.client';
import {
  resolveOutboxBaseBackoff,
  resolveOutboxClaimTtl,
  resolveOutboxConcurrency,
  resolveOutboxMaxAttempts,
  resolveOutboxTimeout,
} from './config';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('outbox-dispatcher');

const ql = cds.ql as typeof cds.ql & {
  DELETE: typeof cds.ql.SELECT;
  INSERT: typeof cds.ql.INSERT;
};

interface OutboxEntry {
  ID: string;
  destinationName: string;
  payload: string;
  status?: string;
  attempts?: number;
  nextAttemptAt?: Date | null;
  eventType?: string;
}

// Circuit breaker cache: one breaker per destination
const circuitBreakers = new Map<string, ReturnType<typeof createCircuitBreaker>>();

/**
 * Create a circuit breaker for a specific destination.
 * Opens after 5 consecutive failures, resets after 10 seconds.
 */
const createCircuitBreaker = () => {
  // TypeScript types don't match runtime API for halfOpenAfter option, using type assertion
  const breaker = (circuitBreaker as any)(handleAll, new ConsecutiveBreaker(5), { halfOpenAfter: 10_000 });
  const timeoutPolicy = timeout(resolveOutboxTimeout(), TimeoutStrategy.Aggressive);
  return wrap(breaker, timeoutPolicy);
};

/**
 * Get or create a circuit breaker for a destination.
 */
const getCircuitBreaker = (destinationName: string) => {
  if (!circuitBreakers.has(destinationName)) {
    circuitBreakers.set(destinationName, createCircuitBreaker());
  }
  return circuitBreakers.get(destinationName)!;
};

/**
 * Move a failed outbox entry to the Dead Letter Queue.
 */
const moveToDLQ = async (db: any, entry: OutboxEntry, lastError: string): Promise<void> => {
  try {
    // Insert into DLQ
    await db.run(
      ql.INSERT.into('clientmgmt.EmployeeNotificationDLQ').entries({
        originalID: entry.ID,
        eventType: entry.eventType ?? 'EMPLOYEE_CREATED',
        destinationName: entry.destinationName,
        payload: entry.payload,
        attempts: entry.attempts ?? 0,
        lastError,
        failedAt: new Date(),
      }),
    );

    // Delete from outbox
    await db.run(ql.DELETE.from('clientmgmt.EmployeeNotificationOutbox').where({ ID: entry.ID }));

    logger.info({ entryId: entry.ID, destinationName: entry.destinationName }, 'Moved failed entry to DLQ');
  } catch (error) {
    logger.error({ err: error, entryId: entry.ID }, 'Failed to move entry to DLQ');
    // Keep entry as FAILED in outbox if DLQ move fails
  }
};

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

  const selectCandidates = (ql.SELECT as any)
    .from('clientmgmt.EmployeeNotificationOutbox')
    .columns('ID', 'destinationName', 'payload', 'status', 'attempts', 'nextAttemptAt', 'eventType')
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
      ql.UPDATE('clientmgmt.EmployeeNotificationOutbox')
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
      const breaker = getCircuitBreaker(entry.destinationName);

      try {
        await breaker.execute(async () => {
          const destination = await getDestination({ destinationName: entry.destinationName });
          if (!destination) {
            throw new Error(`Destination ${entry.destinationName} not found`);
          }

          if ((destination as HttpDestination).url === undefined) {
            throw new Error(`Destination ${entry.destinationName} is not an HTTP destination`);
          }

          const httpDestination = destination as HttpDestination;

          await postEmployeeNotification({
            destination: httpDestination,
            payload: entry.payload,
            secret: secret ?? undefined,
            timeoutMs,
          });
        });

        logger.info({ entryId: entry.ID, destinationName: entry.destinationName }, 'Successfully delivered notification');

        await db.run(
          ql.UPDATE('clientmgmt.EmployeeNotificationOutbox')
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
        const errorMessage = String(error?.message ?? error ?? 'Unknown error');

        logger.warn(
          { err: error, entryId: entry.ID, destinationName: entry.destinationName, attempts },
          'Failed to deliver notification'
        );

        if (attempts >= maxAttempts) {
          // Move to DLQ after exhausting all retries
          await moveToDLQ(db, entry, errorMessage);
        } else {
          // Schedule retry with exponential backoff
          const backoff = Math.pow(2, attempts - 1) * baseBackoff;
          const nextAttemptAt = new Date(Date.now() + backoff);

          await db.run(
            ql.UPDATE('clientmgmt.EmployeeNotificationOutbox')
              .set({
                attempts,
                lastError: errorMessage,
                status: 'PENDING',
                nextAttemptAt,
              })
              .where({ ID: entry.ID }),
          );
        }
      }
    }),
  );
};

export interface EmployeeCreatedNotification {
  destinationName: string;
  payload: Record<string, unknown>;
}

export const enqueueEmployeeCreatedNotification = async (
  tx: Transaction,
  notification: EmployeeCreatedNotification,
): Promise<void> => {
  await tx.run(
    ql.INSERT.into('clientmgmt.EmployeeNotificationOutbox').entries({
      eventType: 'EMPLOYEE_CREATED',
      destinationName: notification.destinationName,
      payload: JSON.stringify(notification.payload),
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
    }),
  );
};

