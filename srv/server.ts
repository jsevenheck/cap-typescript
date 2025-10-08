import cds from '@sap/cds';
import type { Application } from 'express';
import { createHmac } from 'crypto';
import fetch, { type RequestInit, type Response } from 'node-fetch';

const { SELECT, UPDATE } = cds.ql;

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 5000;
const DEFAULT_OUTBOX_TIMEOUT_MS = 15000;

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
  const selectPending = (SELECT as any)
    .from('clientmgmt.EmployeeNotificationOutbox')
    .where({ status: 'PENDING' });

  const rawEntries = (await db.run(selectPending)) as OutboxEntry[];
  const pending = rawEntries
    .filter((entry) => {
      if (!entry.nextAttemptAt) {
        return true;
      }
      const scheduled = new Date(entry.nextAttemptAt as unknown as string).getTime();
      return Number.isFinite(scheduled) && scheduled <= now.getTime();
    })
    .slice(0, 20);

  if (!pending || pending.length === 0) {
    return;
  }

  for (const entry of pending) {
    const claimResult = await db.run(
      UPDATE('clientmgmt.EmployeeNotificationOutbox')
        .set({ status: 'PROCESSING', nextAttemptAt: now })
        .where({ ID: entry.ID, status: 'PENDING' }),
    );

    const claimed = typeof claimResult === 'number' ? claimResult : Array.isArray(claimResult) ? claimResult[0] : 0;

    if (!claimed) {
      continue;
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const secret = process.env.THIRD_PARTY_EMPLOYEE_SECRET;
    if (secret) {
      const signature = createHmac('sha256', secret).update(String(entry.payload ?? '')).digest('hex');
      headers['x-signature-sha256'] = signature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolveOutboxTimeout());

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
    } finally {
      clearTimeout(timeout);
    }
  }
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
  }, 5000);
});

export default cds.server;
