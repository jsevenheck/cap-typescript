import { jest } from '@jest/globals';

describe('getSecret', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    delete process.env.THIRD_PARTY_EMPLOYEE_SECRET;
  });

  it('logs missing secrets only once per key', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { getSecret } = await import('../../shared/utils/secrets');

    await getSecret('employee-export', 'notification-secret', 'THIRD_PARTY_EMPLOYEE_SECRET');
    await getSecret('employee-export', 'notification-secret', 'THIRD_PARTY_EMPLOYEE_SECRET');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
