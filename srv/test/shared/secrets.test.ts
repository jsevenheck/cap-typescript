import { jest } from '@jest/globals';

describe('getSecret', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    delete process.env.THIRD_PARTY_EMPLOYEE_SECRET;
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('logs missing secrets only once per key', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { getSecret } = await import('../../shared/utils/secrets');

    await getSecret('employee-export', 'notification-secret', 'THIRD_PARTY_EMPLOYEE_SECRET');
    await getSecret('employee-export', 'notification-secret', 'THIRD_PARTY_EMPLOYEE_SECRET');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to environment variables if Credential Store requests time out', async () => {
    jest.useFakeTimers();

    jest.doMock('@sap/xsenv', () => ({
      getServices: () => ({ credstore: { credentials: { url: 'https://credstore.example.local' } } }),
    }), { virtual: true });

    process.env.THIRD_PARTY_EMPLOYEE_SECRET = 'env-fallback-secret';

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => new Promise(() => undefined) as unknown as Promise<Response>);

    const { getSecret } = await import('../../shared/utils/secrets');

    const secretPromise = getSecret('employee-export', 'notification-secret', 'THIRD_PARTY_EMPLOYEE_SECRET');

    jest.advanceTimersByTime(6000);

    await expect(secretPromise).resolves.toBe('env-fallback-secret');
    expect(fetchSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
