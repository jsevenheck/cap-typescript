import { defaultOutboxConfig } from '../../../infrastructure/outbox/config';
import { ParallelDispatcher } from '../../../infrastructure/outbox/dispatcher';

describe('ParallelDispatcher unit behavior', () => {
  const buildDispatcher = () => {
    const metrics = {
      recordDispatched: jest.fn(),
      recordDispatchDuration: jest.fn(),
      recordFailed: jest.fn(),
    } as any;
    const notifier = {
      dispatchEnvelope: jest.fn().mockResolvedValue(undefined),
    } as any;
    const dispatcher = new ParallelDispatcher(defaultOutboxConfig(), metrics, notifier);
    return { dispatcher, metrics, notifier };
  };

  it('skips completion updates when tenant context is missing', async () => {
    const { dispatcher, metrics, notifier } = buildDispatcher();
    const db = { run: jest.fn() } as any;

    await (dispatcher as any).dispatchOne(db, {
      ID: 'without-tenant',
      eventType: 'EMPLOYEE_CREATED',
      destinationName: 'https://example.com/hook',
      payload: JSON.stringify({ body: { ok: true } }),
      tenant: null,
    });

    expect(notifier.dispatchEnvelope).toHaveBeenCalledTimes(1);
    expect(db.run).not.toHaveBeenCalled();
    expect(metrics.recordDispatched).not.toHaveBeenCalled();
    expect(metrics.recordDispatchDuration).not.toHaveBeenCalled();
  });

  it('does not attempt retries when failure occurs without tenant context', async () => {
    const { dispatcher, metrics, notifier } = buildDispatcher();
    notifier.dispatchEnvelope.mockRejectedValueOnce(new Error('boom'));
    const db = { run: jest.fn() } as any;

    await (dispatcher as any).dispatchOne(db, {
      ID: 'failing-tenant',
      eventType: 'EMPLOYEE_CREATED',
      destinationName: 'https://example.com/hook',
      payload: JSON.stringify({ body: { ok: true } }),
      tenant: undefined,
    });

    expect(db.run).not.toHaveBeenCalled();
    expect(metrics.recordFailed).not.toHaveBeenCalled();
  });
});
