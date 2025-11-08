import path from 'node:path';
import cds from '@sap/cds';
import * as prom from 'prom-client';

import { defaultOutboxConfig, type OutboxConfig } from '../../../infrastructure/outbox/config';
import { ParallelDispatcher, enqueueOutboxEntry } from '../../../infrastructure/outbox/dispatcher';
import OutboxMetrics from '../../../infrastructure/outbox/metrics';
import { OutboxCleanup } from '../../../infrastructure/outbox/cleanup';

cds.test(path.join(__dirname, '..', '..', '..'));

const OUTBOX_TABLE = 'clientmgmt.EmployeeNotificationOutbox';
const DLQ_TABLE = 'clientmgmt.EmployeeNotificationDLQ';

class StubNotifier {
  constructor(private readonly handler: jest.Mock) {}

  async dispatchEnvelope(eventType: string, endpoint: string, envelope: any): Promise<void> {
    await this.handler(eventType, endpoint, envelope);
  }
}

describe('ParallelDispatcher', () => {
  let db: any;

  beforeAll(async () => {
    db = await cds.connect.to('db');
    try {
      await (cds as any).deploy(path.join(__dirname, '..', '..', '..')).to(db);
    } catch (error) {
      console.log('Database deployment info:', error);
    }
  });

  afterEach(async () => {
    await db.run((cds.ql as any).DELETE.from(OUTBOX_TABLE));
    await db.run((cds.ql as any).DELETE.from(DLQ_TABLE));
    jest.clearAllMocks();
  });

  const buildDispatcher = (overrides: Partial<OutboxConfig> = {}, handler?: jest.Mock): ParallelDispatcher => {
    const config = { ...defaultOutboxConfig(), ...overrides };
    const registry = new prom.Registry();
    const metrics = new OutboxMetrics(registry);
    const notifier = new StubNotifier(handler ?? jest.fn().mockResolvedValue(undefined));
    return new ParallelDispatcher(config, metrics, notifier as any);
  };

  it('delivers pending entries and marks them as completed', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = buildDispatcher({ dispatcherWorkers: 2 }, handler);

    await db.run(
      (cds.ql as any).INSERT.into(OUTBOX_TABLE).entries({
        ID: 'notif-1',
        eventType: 'EMPLOYEE_CREATED',
        destinationName: 'https://example.com/hook',
        payload: JSON.stringify({ body: { eventType: 'EMPLOYEE_CREATED', employees: [] } }),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 1000),
      }),
    );

    await dispatcher.dispatchPending();

    expect(handler).toHaveBeenCalledTimes(1);
    const updated = await db.run(
      (cds.ql as any).SELECT.one.from(OUTBOX_TABLE).where({ ID: 'notif-1' }),
    );
    expect(updated.status).toBe('COMPLETED');
    expect(updated.claimedAt).toBeNull();
    expect(updated.claimedBy).toBeNull();
  });

  it('supports legacy payloads persisted without an envelope wrapper', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = buildDispatcher({}, handler);

    const legacyPayload = {
      eventType: 'EMPLOYEE_CREATED',
      employees: [{ employeeId: 'LEG-1' }],
      secret: 'legacy-secret',
      headers: { 'x-extra': 'value', 'x-numeric': 42 as any },
    };

    await db.run(
      (cds.ql as any).INSERT.into(OUTBOX_TABLE).entries({
        ID: 'legacy-1',
        eventType: 'EMPLOYEE_CREATED',
        destinationName: 'https://example.com/legacy',
        payload: JSON.stringify(legacyPayload),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 1000),
      }),
    );

    await dispatcher.dispatchPending();

    expect(handler).toHaveBeenCalledTimes(1);
    const [, , envelope] = handler.mock.calls[0];
    expect(envelope.body).toMatchObject({
      eventType: 'EMPLOYEE_CREATED',
      employees: [{ employeeId: 'LEG-1' }],
    });
    expect(envelope.body).not.toHaveProperty('secret');
    expect(envelope.body).not.toHaveProperty('headers');
    expect(envelope.secret).toBe('legacy-secret');
    expect(envelope.headers).toEqual({ 'x-extra': 'value' });
  });

  it('retries failed dispatches with exponential backoff', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('network failure'));
    const dispatcher = buildDispatcher({ retryDelay: 10, maxAttempts: 3 }, handler);

    await db.run(
      (cds.ql as any).INSERT.into(OUTBOX_TABLE).entries({
        ID: 'notif-retry',
        eventType: 'EMPLOYEE_CREATED',
        destinationName: 'https://example.com/retry',
        payload: JSON.stringify({ body: { eventType: 'EMPLOYEE_CREATED', employees: [] } }),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 1000),
      }),
    );

    await dispatcher.dispatchPending();

    const updated = await db.run(
      (cds.ql as any).SELECT.one.from(OUTBOX_TABLE).where({ ID: 'notif-retry' }),
    );
    expect(updated.status).toBe('PENDING');
    expect(updated.attempts).toBe(1);
    expect(new Date(updated.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    expect(updated.lastError).toContain('network failure');
  });

  it('moves entries to the DLQ after reaching max attempts', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('permanent failure'));
    const dispatcher = buildDispatcher({ retryDelay: 10, maxAttempts: 2 }, handler);

    await db.run(
      (cds.ql as any).INSERT.into(OUTBOX_TABLE).entries({
        ID: 'notif-dlq',
        eventType: 'EMPLOYEE_CREATED',
        destinationName: 'https://example.com/dlq',
        payload: JSON.stringify({ body: { eventType: 'EMPLOYEE_CREATED', employees: [] } }),
        status: 'PENDING',
        attempts: 1,
        nextAttemptAt: new Date(Date.now() - 1000),
      }),
    );

    await dispatcher.dispatchPending();

    const remaining = await db.run(
      (cds.ql as any).SELECT.one.from(OUTBOX_TABLE).where({ ID: 'notif-dlq' }),
    );
    expect(remaining).toBeUndefined();

    const dlqEntry = await db.run(
      (cds.ql as any).SELECT.one.from(DLQ_TABLE).where({ originalID: 'notif-dlq' }),
    );
    expect(dlqEntry).toBeDefined();
    expect(dlqEntry.lastError).toContain('permanent failure');
  });

  it('releases stale claims before dispatching', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = buildDispatcher({ claimTtl: 5, dispatcherWorkers: 1 }, handler);

    await db.run(
      (cds.ql as any).INSERT.into(OUTBOX_TABLE).entries({
        ID: 'notif-claimed',
        eventType: 'EMPLOYEE_CREATED',
        destinationName: 'https://example.com/claimed',
        payload: JSON.stringify({ body: { eventType: 'EMPLOYEE_CREATED', employees: [] } }),
        status: 'PROCESSING',
        attempts: 0,
        claimedAt: new Date(Date.now() - 6000),
        claimedBy: 'other-worker',
        nextAttemptAt: new Date(Date.now() - 6000),
      }),
    );

    await dispatcher.dispatchPending();

    const updated = await db.run(
      (cds.ql as any).SELECT.one.from(OUTBOX_TABLE).where({ ID: 'notif-claimed' }),
    );
    expect(updated.status).toBe('COMPLETED');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries enqueueing with exponential backoff', async () => {
    const config = { ...defaultOutboxConfig(), retryDelay: 5, enqueueMaxAttempts: 3 };
    const registry = new prom.Registry();
    const metrics = new OutboxMetrics(registry);

    const tx = {
      run: jest
        .fn()
        .mockRejectedValueOnce(new Error('locked'))
        .mockResolvedValueOnce(undefined),
    } as any;

    await enqueueOutboxEntry(tx, {
      eventType: 'EMPLOYEE_CREATED',
      endpoint: 'https://example.com/enqueue',
      payload: { body: { eventType: 'EMPLOYEE_CREATED', employees: [] } },
    }, config, metrics);

    expect(tx.run).toHaveBeenCalledTimes(2);
  });

  it('surfaces enqueue failure after bounded retries when max attempts is unset', async () => {
    const config = { ...defaultOutboxConfig(), retryDelay: 1, maxAttempts: 4, enqueueMaxAttempts: 0 };
    const registry = new prom.Registry();
    const metrics = new OutboxMetrics(registry);

    const error = new Error('locked');
    const tx = {
      run: jest.fn().mockRejectedValue(error),
    } as any;

    await expect(
      enqueueOutboxEntry(
        tx,
        {
          eventType: 'EMPLOYEE_CREATED',
          endpoint: 'https://example.com/enqueue',
          payload: { body: { eventType: 'EMPLOYEE_CREATED', employees: [] } },
        },
        config,
        metrics,
      ),
    ).rejects.toBe(error);

    expect(tx.run).toHaveBeenCalledTimes(config.maxAttempts);
  });

  it('cleans up processed entries after retention period', async () => {
    const cleanup = new OutboxCleanup({ ...defaultOutboxConfig(), cleanupRetention: 10 });

    await db.run(
      (cds.ql as any).INSERT.into(OUTBOX_TABLE).entries({
        ID: 'notif-clean',
        eventType: 'EMPLOYEE_CREATED',
        destinationName: 'https://example.com/clean',
        payload: JSON.stringify({ body: { eventType: 'EMPLOYEE_CREATED', employees: [] } }),
        status: 'COMPLETED',
        attempts: 1,
        nextAttemptAt: null,
        modifiedAt: new Date(Date.now() - 1000),
      }),
    );

    await cleanup.run();

    const remaining = await db.run(
      (cds.ql as any).SELECT.one.from(OUTBOX_TABLE).where({ ID: 'notif-clean' }),
    );
    expect(remaining).toBeUndefined();
  });
});
