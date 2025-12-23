import express, { RequestHandler } from 'express';
import request from 'supertest';

let currentApiKey = 'initial-key';
const originalEnv = { ...process.env };

jest.mock('../../shared/utils/secrets', () => ({
  __esModule: true,
  getEmployeeExportApiKey: jest.fn(async () => currentApiKey),
}));

const getSecretsMock = () =>
  jest.requireMock('../../shared/utils/secrets') as { getEmployeeExportApiKey: jest.Mock<Promise<string | undefined>, []> };

const importApiKeyModule = async (envOverrides: Record<string, string> = {}) => {
  jest.resetModules();
  process.env = { ...originalEnv, ...envOverrides };
  return import('../../middleware/apiKey');
};

const createApp = (middleware: RequestHandler) => {
  const app = express();
  app.get('/api/employees/active', middleware, (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
};

describe('apiKeyMiddleware', () => {
  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
    currentApiKey = 'initial-key';
    jest.clearAllMocks();
  });

  it('accepts rotated API keys without restarting the server', async () => {
    const apiKeyModule = await importApiKeyModule({ EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0' });
    const { apiKeyMiddleware, forceReloadApiKey, loadApiKey, resetApiKeyCacheForTest, stopApiKeyRefreshScheduler } = apiKeyModule;

    resetApiKeyCacheForTest();
    const app = createApp(apiKeyMiddleware);

    await loadApiKey({ force: true, reason: 'test-initial-load' });

    await request(app).get('/api/employees/active').set('x-api-key', 'initial-key').expect(200);

    currentApiKey = 'rotated-key';
    await forceReloadApiKey();

    await request(app).get('/api/employees/active').set('x-api-key', 'initial-key').expect(401);
    await request(app).get('/api/employees/active').set('x-api-key', 'rotated-key').expect(200);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });

  it('respects TTL and avoids reloading before expiration', async () => {
    const apiKeyModule = await importApiKeyModule({
      EMPLOYEE_EXPORT_API_KEY_TTL_MS: '5000',
      EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0',
    });
    const { loadApiKey, resetApiKeyCacheForTest, stopApiKeyRefreshScheduler } = apiKeyModule;
    const { getEmployeeExportApiKey } = getSecretsMock();

    resetApiKeyCacheForTest();
    currentApiKey = 'initial-key';

    await loadApiKey({ force: true, reason: 'test-initial-load' });
    await loadApiKey({ reason: 'within-ttl' });

    expect(getEmployeeExportApiKey).toHaveBeenCalledTimes(1);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });

  it('forces a reload even when TTL has not expired', async () => {
    const apiKeyModule = await importApiKeyModule({
      EMPLOYEE_EXPORT_API_KEY_TTL_MS: '600000',
      EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0',
    });
    const { loadApiKey, resetApiKeyCacheForTest, stopApiKeyRefreshScheduler } = apiKeyModule;
    const { getEmployeeExportApiKey } = getSecretsMock();

    resetApiKeyCacheForTest();
    currentApiKey = 'initial-key';

    await loadApiKey({ force: true, reason: 'initial-load' });
    getEmployeeExportApiKey.mockClear();
    currentApiKey = 'forced-rotation';

    await loadApiKey({ force: true, reason: 'manual-force' });

    expect(getEmployeeExportApiKey).toHaveBeenCalledTimes(1);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });

  it('shares in-flight refresh work across concurrent callers', async () => {
    const apiKeyModule = await importApiKeyModule({
      EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0',
    });
    const { loadApiKey, resetApiKeyCacheForTest, stopApiKeyRefreshScheduler } = apiKeyModule;
    const { getEmployeeExportApiKey } = getSecretsMock();

    resetApiKeyCacheForTest();
    let resolveKey: (value: string | undefined) => void = () => {};

    getEmployeeExportApiKey.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveKey = resolve;
        }),
    );

    const first = loadApiKey({ force: true, reason: 'concurrent-1' });
    const second = loadApiKey({ force: true, reason: 'concurrent-2' });

    resolveKey?.('shared-key');

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(getEmployeeExportApiKey).toHaveBeenCalledTimes(1);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });

  it('pauses the refresh scheduler after repeated failures', async () => {
    jest.useFakeTimers();
    const apiKeyModule = await importApiKeyModule({
      EMPLOYEE_EXPORT_API_KEY_TTL_MS: '10',
      EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0',
      EMPLOYEE_EXPORT_API_KEY_REFRESH_BACKOFF_MIN_MS: '5',
      EMPLOYEE_EXPORT_API_KEY_REFRESH_BACKOFF_MAX_MS: '20',
    });
    const {
      resetApiKeyCacheForTest,
      startApiKeyRefreshScheduler,
      stopApiKeyRefreshScheduler,
    } = apiKeyModule;
    const { getEmployeeExportApiKey } = getSecretsMock();

    resetApiKeyCacheForTest();
    getEmployeeExportApiKey.mockRejectedValue(new Error('unavailable'));

    startApiKeyRefreshScheduler();

    // First scheduled refresh fires at TTL (10ms) and subsequent retries backoff until the circuit pauses after 5 failures.
    for (let i = 0; i < 6; i += 1) {
      if (typeof jest.runOnlyPendingTimersAsync === 'function') {
        await jest.runOnlyPendingTimersAsync();
      } else {
        jest.runOnlyPendingTimers();
      }
    }

    expect(getEmployeeExportApiKey).toHaveBeenCalledTimes(5);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });
});
