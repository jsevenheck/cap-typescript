import cds from '@sap/cds';
import type { Application } from 'express';
import type { RequestInit, Response } from 'node-fetch';

const { SELECT, UPDATE } = cds.ql;

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 5000;

interface OutboxEntry {
  ID: string;
  endpoint: string;
  payload: string;
  status?: string;
  attempts?: number;
  nextAttemptAt?: Date | null;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

let fetchLoader: Promise<FetchFn> | undefined;

const getFetch = async (): Promise<FetchFn> => {
  if (!fetchLoader) {
    fetchLoader = import('node-fetch').then((module) => {
      const candidate = (module as { default?: FetchFn }).default ?? (module as unknown as FetchFn);
      return candidate;
    });
  }
  return fetchLoader;
};

export const processOutbox = async (): Promise<void> => {
  const db = await cds.connect.to('db');
  if (!db) {
    return;
  }

  const now = new Date();
  const selectPending = (SELECT as any)
    .from('clientmgmt.EmployeeNotificationOutbox')
    .where({ status: 'PENDING' });

  const rawEntries = (await db.run(selectPending)) as OutboxEntry[];
  const pending = rawEntries
    .filter((entry) => {
      if (!entry.nextAttemptAt) {
        return true;
      }
      const scheduledAt = new Date(entry.nextAttemptAt as unknown as string).getTime();
      return Number.isFinite(scheduledAt) && scheduledAt <= now.getTime();
    })
    .slice(0, 20);

  if (!pending || pending.length === 0) {
    return;
  }

  const fetch = await getFetch();

  for (const entry of pending) {
    try {
      const response = await fetch(entry.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: entry.payload,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`HTTP ${response.status} ${message}`.trim());
      }

      await db.run(
        UPDATE('clientmgmt.EmployeeNotificationOutbox')
          .set({
            status: 'DELIVERED',
            deliveredAt: new Date(),
            lastError: null,
            nextAttemptAt: null,
          })
          .where({ ID: entry.ID }),
      );
    } catch (error: any) {
      const attempts = (entry.attempts ?? 0) + 1;
      const backoff = Math.pow(2, attempts - 1) * BASE_DELAY_MS;

      await db.run(
        UPDATE('clientmgmt.EmployeeNotificationOutbox')
          .set({
            attempts,
            lastError: String(error?.message ?? error ?? 'Unknown error'),
            status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
            nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + backoff),
          })
          .where({ ID: entry.ID }),
      );
    }
  }
};

cds.on('bootstrap', (app: Application) => {
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
});

cds.on('served', () => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const logger = (cds as any).log?.('outbox') ?? console;
  setInterval(() => {
    processOutbox().catch((error) => {
      logger.error?.('Outbox processing failed:', error);
    });
  }, 5000);
});

export default cds.server;
