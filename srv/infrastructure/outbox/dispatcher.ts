import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { OutboxConfig } from './config';
import { OutboxMetrics } from './metrics';
import {
  EmployeeThirdPartyNotifier,
  type NotificationEnvelope,
} from '../api/third-party/employee-notifier';
import { getLogger } from '../../shared/utils/logger';

const ql = cds.ql as any;

const OUTBOX_TABLE = 'clientmgmt.EmployeeNotificationOutbox';
const DLQ_TABLE = 'clientmgmt.EmployeeNotificationDLQ';

const MAX_OUTBOX_PAYLOAD_BYTES = 500 * 1024; // 500KB safety limit
const ALLOWED_OUTBOX_HEADERS = new Set(['content-type', 'x-signature-sha256', 'x-correlation-id']);

const logger = getLogger('outbox-dispatcher');

export interface OutboxEntry {
  ID: string;
  eventType: string;
  destinationName: string;
  payload: string;
  status?: string;
  attempts?: number;
  nextAttemptAt?: Date | null;
  claimedAt?: Date | null;
  claimedBy?: string | null;
  lastError?: string | null;
}

interface ParsedPayload extends NotificationEnvelope {
  body: Record<string, unknown>;
}

const sanitizeHeaders = (headers: unknown): Record<string, string> | undefined => {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (ALLOWED_OUTBOX_HEADERS.has(lowerKey)) {
      normalized[lowerKey] = value;
    }
  }

  return Object.keys(normalized).length ? normalized : undefined;
};

const enforceMaxPayloadSize = (body: Record<string, unknown>): void => {
  const serialized = JSON.stringify(body);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeBytes > MAX_OUTBOX_PAYLOAD_BYTES) {
    throw new Error(`Payload exceeds maximum allowed size of ${MAX_OUTBOX_PAYLOAD_BYTES} bytes`);
  }
};

const parsePayload = (entry: OutboxEntry): ParsedPayload => {
  try {
    const value = JSON.parse(entry.payload ?? '{}');
    if (!value || typeof value !== 'object') {
      throw new Error('Payload must be an object.');
    }

    const record = value as Record<string, unknown>;
    const bodyCandidate = record['body'];

    if (bodyCandidate && typeof bodyCandidate === 'object') {
      enforceMaxPayloadSize(bodyCandidate as Record<string, unknown>);

      const secretCandidate = record['secret'];
      const headersCandidate = record['headers'];

      return {
        body: bodyCandidate as Record<string, unknown>,
        secret: typeof secretCandidate === 'string' ? (secretCandidate as string) : undefined,
        headers: sanitizeHeaders(headersCandidate),
      };
    }

    const legacyBody = { ...record } as Record<string, unknown>;
    const secret = legacyBody['secret'];
    if (typeof secret === 'string') {
      delete legacyBody['secret'];
    }

    const headers = legacyBody['headers'];
    if (headers && typeof headers === 'object') {
      delete legacyBody['headers'];
    }

    if (!Object.keys(legacyBody).length) {
      throw new Error('Payload body is required.');
    }

    enforceMaxPayloadSize(legacyBody);

    return {
      body: legacyBody,
      secret: typeof secret === 'string' ? secret : undefined,
      headers: sanitizeHeaders(headers),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown payload parsing error';
    throw new Error(`Failed to parse outbox payload for entry ${entry.ID}: ${message}`);
  }
};

const moveToDlq = async (
  db: any,
  entry: OutboxEntry,
  attempts: number,
  lastError: string,
): Promise<void> => {
  try {
    await db.run(
      ql.INSERT.into(DLQ_TABLE).entries({
        originalID: entry.ID,
        eventType: entry.eventType,
        destinationName: entry.destinationName,
        payload: entry.payload,
        attempts,
        lastError,
        failedAt: new Date(),
        
      }),
    );

    await db.run(ql.DELETE.from(OUTBOX_TABLE).where({ ID: entry.ID }));
  } catch (error) {
    logger.error({ err: error, entryId: entry.ID }, 'Failed to move entry to DLQ');
  }
};

export class ParallelDispatcher {
  private readonly workerId: string;
  private readonly notifier: EmployeeThirdPartyNotifier;

  constructor(
    private readonly config: OutboxConfig,
    private readonly metrics: OutboxMetrics,
    notifier?: EmployeeThirdPartyNotifier,
  ) {
    this.workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.notifier = notifier ?? new EmployeeThirdPartyNotifier();
  }

  async dispatchPending(): Promise<void> {
    const db = (cds as any).db ?? (await cds.connect.to('db'));
    if (!db) {
      return;
    }

    const now = new Date();
    await this.releaseExpiredClaims(db, now);

    const candidates = (await db.run(
      ql.SELECT.from(OUTBOX_TABLE)
        .columns(
          'ID',
          'eventType',
          'destinationName',
          'payload',
          'status',
          'attempts',
          'nextAttemptAt',
          'claimedAt',
          'claimedBy',
          'lastError',
        )
        .where({ status: 'PENDING' })
        .orderBy('nextAttemptAt')
        .limit(this.config.batchSize),
    )) as OutboxEntry[];

    if (!candidates.length) {
      await this.updatePendingGauge(db);
      return;
    }

    const nowTime = now.getTime();
    const claimable = candidates.filter((entry) => {
      const status = entry.status ?? 'PENDING';
      const nextAttemptAt = entry.nextAttemptAt
        ? new Date(entry.nextAttemptAt).getTime()
        : undefined;

      if (status === 'PENDING') {
        return !nextAttemptAt || nextAttemptAt <= nowTime;
      }

      if (status === 'PROCESSING') {
        return (
          entry.claimedAt && new Date(entry.claimedAt).getTime() + this.config.claimTtl <= nowTime
        );
      }

      return false;
    });

    if (!claimable.length) {
      await this.updatePendingGauge(db);
      return;
    }

    const claimed: OutboxEntry[] = [];

    // Revert to safer loop-based approach to prevent race conditions (Double Dispatch)
    // which was a risk with the bulk update without proper affected rows check/RETURNING.
    // This is less efficient (N+1 updates) but strictly correct for exactly-once claiming.
    for (const entry of claimable) {
      const result = await db.run(
        ql
          .UPDATE(OUTBOX_TABLE)
          .set({
            status: 'PROCESSING',
            claimedAt: now,
            claimedBy: this.workerId,
            nextAttemptAt: now,
          })
          .where({
            ID: entry.ID,
            status: 'PENDING' // Optimistic lock: only claim if still pending
          }),
      );

      const affectedRows = Array.isArray(result) ? Number(result[0]) : Number(result ?? 0);
      if (!affectedRows) {
        // Another worker claimed it first
        continue;
      }

      claimed.push({
        ...entry,
        status: 'PROCESSING',
        claimedAt: now,
        claimedBy: this.workerId,
      });
    }

    if (!claimed.length) {
      await this.updatePendingGauge(db);
      return;
    }

    await this.dispatchBatch(db, claimed);
    await this.updatePendingGauge(db);
  }

  private async dispatchBatch(db: any, entries: OutboxEntry[]): Promise<void> {
    const queue = [...entries];
    const workerCount = this.config.parallelDispatchEnabled ? this.config.dispatcherWorkers : 1;
    const workers = Math.max(1, Math.min(workerCount, queue.length));
    const tasks = Array.from({ length: workers }, () => this.runWorker(db, queue));
    await Promise.allSettled(tasks);
  }

  private async runWorker(db: any, queue: OutboxEntry[]): Promise<void> {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) {
        return;
      }
      await this.dispatchOne(db, entry);
    }
  }

  private async dispatchOne(db: any, entry: OutboxEntry): Promise<void> {
    const startTime = Date.now();

    let parsed: ParsedPayload;
    try {
      parsed = parsePayload(entry);
    } catch (error) {
      logger.error({ err: error, entryId: entry.ID }, 'Invalid outbox payload');
      await this.handleFailure(
        db,
        entry,
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }

    try {
      await this.notifier.dispatchEnvelope(entry.eventType, entry.destinationName, parsed);

      await db.run(
        ql
          .UPDATE(OUTBOX_TABLE)
          .set({
            status: 'COMPLETED',
            deliveredAt: new Date(),
            claimedAt: null,
            claimedBy: null,
            nextAttemptAt: null,
            lastError: null,
          })
          .where({ ID: entry.ID }),
      );

      const duration = Date.now() - startTime;
      this.metrics.recordDispatched();
      this.metrics.recordDispatchDuration(duration);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.metrics.recordDispatchDuration(duration);
      await this.handleFailure(db, entry, error);
    }
  }

  private async handleFailure(db: any, entry: OutboxEntry, error: Error): Promise<void> {
    const attempts = (entry.attempts ?? 0) + 1;
    const errorMessage = error?.message ?? 'Unknown error';

    logger.warn(
      { err: error, entryId: entry.ID, destination: entry.destinationName, attempts },
      'Failed to dispatch outbox entry',
    );

    if (attempts >= this.config.maxAttempts) {
      await moveToDlq(db, entry, attempts, errorMessage);
      this.metrics.recordFailed();
      return;
    }

    const delay = Math.max(1, Math.pow(2, attempts - 1) * this.config.retryDelay);
    const nextAttemptAt = new Date(Date.now() + delay + 1);

    await db.run(
      ql
        .UPDATE(OUTBOX_TABLE)
        .set({
          attempts,
          status: 'PENDING',
          nextAttemptAt,
          claimedAt: null,
          claimedBy: null,
          lastError: errorMessage,
        })
        .where({ ID: entry.ID }),
    );

    this.metrics.recordFailed();
  }

  private async releaseExpiredClaims(db: any, now: Date): Promise<void> {
    const expiry = new Date(now.getTime() - this.config.claimTtl);
    await db.run(
      ql
        .UPDATE(OUTBOX_TABLE)
        .set({ status: 'PENDING', claimedAt: null, claimedBy: null })
        .where({ status: 'PROCESSING', claimedAt: { '<': expiry } }),
    );
  }

  private async updatePendingGauge(db: any): Promise<void> {
    const result = await db.run(
      ql.SELECT.from(OUTBOX_TABLE)
        .columns('count(1) as pendingCount')
        .where({ status: { in: ['PENDING', 'PROCESSING'] } }),
    );

    const rows = Array.isArray(result) ? result : [result];
    const countValue = rows[0]?.pendingCount ?? rows[0]?.COUNT ?? rows[0]?.count ?? 0;
    const parsed = Number(countValue) || 0;
    this.metrics.updatePending(parsed);
  }
}

export interface OutboxEnqueueInput {
  eventType: string;
  destinationName: string;
  payload: NotificationEnvelope;
}

const serializePayload = (payload: NotificationEnvelope): string =>
  JSON.stringify({
    body: payload.body,
    secret: payload.secret,
    headers: payload.headers,
  });

/**
 * Enqueue an outbox entry for reliable event delivery.
 *
 * IMPORTANT: This function will throw if enqueue fails after all retry attempts,
 * which will cause the parent transaction to rollback. This ensures atomicity
 * between the business operation and the outbox entry - both succeed or both fail.
 *
 * @param tx - The active transaction
 * @param input - The outbox entry details
 * @param config - Outbox configuration
 * @param metrics - Metrics collector
 * @throws {Error} If enqueue fails after all retry attempts (triggers transaction rollback)
 */
export const enqueueOutboxEntry = async (
  tx: Transaction,
  input: OutboxEnqueueInput,
  config: OutboxConfig,
  metrics: OutboxMetrics,
): Promise<void> => {
  const maxAttempts =
    config.enqueueMaxAttempts > 0 ? config.enqueueMaxAttempts : config.maxAttempts;

  let attempt = 1;
  while (attempt <= maxAttempts) {
    try {
      await tx.run(
        ql.INSERT.into(OUTBOX_TABLE).entries({
          eventType: input.eventType,
          destinationName: input.destinationName,
          payload: serializePayload(input.payload),
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(),
          }),
      );

      metrics.recordEnqueued(1);

      if (attempt > 1) {
        logger.info(
          { eventType: input.eventType, destinationName: input.destinationName, attempt },
          `Successfully enqueued after ${attempt} attempt(s)`,
        );
        metrics.recordEnqueueRetrySuccess();
      }

      return;
    } catch (error) {
      if (attempt >= maxAttempts) {
        logger.error(
          {
            err: error,
            eventType: input.eventType,
            destinationName: input.destinationName,
            attempts: attempt,
          },
          `Failed to enqueue outbox entry after ${attempt} attempts - transaction will rollback`,
        );
        metrics.recordEnqueueFailure();

        // Re-throw to trigger transaction rollback and prevent data loss
        // This ensures the parent operation fails atomically if we cannot guarantee event delivery
        const enrichedError = error instanceof Error ? error : new Error(String(error));
        enrichedError.message = `Outbox enqueue failed after ${attempt} attempts: ${enrichedError.message}`;
        throw enrichedError;
      }

      const exponent = Math.max(0, attempt - 1);
      const delay = config.enqueueRetryDelay * Math.pow(2, exponent);

      logger.warn(
        {
          err: error,
          eventType: input.eventType,
          destinationName: input.destinationName,
          attempt,
          retryDelayMs: delay,
        },
        `Enqueue attempt ${attempt} failed, retrying in ${delay}ms`,
      );
      metrics.recordEnqueueRetry();

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      attempt += 1;
    }
  }
};
