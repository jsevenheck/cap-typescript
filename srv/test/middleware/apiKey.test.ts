import crypto from 'node:crypto';
import express, { RequestHandler } from 'express';
import request from 'supertest';

import type { Request, Response } from 'express';

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

const registerReloadEndpoint = (
  app: ReturnType<typeof express>,
  handlers: {
    readApiKeyFromRequest: (req: Request) => string | undefined;
    isApiKeyValid: (providedKey: string | undefined, referenceKey?: string) => boolean;
    forceReloadApiKey: () => Promise<{ loaded: boolean; rotated: boolean; source: string }>;
    getCachedApiKeySnapshot: () => string | undefined;
  },
  reloadToken?: string,
) => {
  app.post('/api/employees/active/reload-key', (req: Request, res: Response) => {
    void (async () => {
      if (process.env.NODE_ENV === 'production') {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const providedReloadToken = req.header('x-reload-token')?.trim();
      const providedApiKey = handlers.readApiKeyFromRequest(req);
      const cachedApiKey = handlers.getCachedApiKeySnapshot();

      const authorizedByToken = Boolean(
        reloadToken
          && providedReloadToken
          && Buffer.byteLength(providedReloadToken, 'utf8') === Buffer.byteLength(reloadToken, 'utf8')
          && crypto.timingSafeEqual(Buffer.from(providedReloadToken, 'utf8'), Buffer.from(reloadToken, 'utf8')),
      );
      const authorizedByApiKey = Boolean(cachedApiKey && handlers.isApiKeyValid(providedApiKey, cachedApiKey));

      if (!authorizedByToken && !authorizedByApiKey) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      try {
        const reloadResult = await handlers.forceReloadApiKey();
        res.status(reloadResult.loaded ? 200 : 503).json({ reloaded: reloadResult.loaded, rotated: reloadResult.rotated });
      } catch {
        res.status(500).json({ error: 'reload_failed' });
      }
    })();
  });
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
    let fulfillPromise: (value: string | undefined) => void = () => {};

    getEmployeeExportApiKey.mockImplementation(
      () =>
        new Promise((resolve) => {
          fulfillPromise = resolve;
        }),
    );

    const first = loadApiKey({ force: true, reason: 'concurrent-1' });
    const second = loadApiKey({ force: true, reason: 'concurrent-2' });

    fulfillPromise?.('shared-key');

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

  it('authorizes reload endpoint via cached API key without being affected by rotation during reload', async () => {
    const apiKeyModule = await importApiKeyModule({
      EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0',
    });
    const {
      apiKeyMiddleware,
      forceReloadApiKey,
      getCachedApiKeySnapshot,
      isApiKeyValid,
      loadApiKey,
      readApiKeyFromRequest,
      resetApiKeyCacheForTest,
      stopApiKeyRefreshScheduler,
    } = apiKeyModule;

    resetApiKeyCacheForTest();
    await loadApiKey({ force: true, reason: 'test-initial-load' });

    const app = express();
    app.get('/api/employees/active', apiKeyMiddleware, (_req, res) => res.json({ status: 'ok' }));
    registerReloadEndpoint(app, { readApiKeyFromRequest, isApiKeyValid, forceReloadApiKey, getCachedApiKeySnapshot });

    await request(app).post('/api/employees/active/reload-key').set('x-api-key', 'initial-key').expect(200);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });

  it('authorizes reload endpoint via reload token even when no cached key exists', async () => {
    const apiKeyModule = await importApiKeyModule({
      EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0',
    });
    const {
      forceReloadApiKey,
      getCachedApiKeySnapshot,
      isApiKeyValid,
      readApiKeyFromRequest,
      resetApiKeyCacheForTest,
      stopApiKeyRefreshScheduler,
    } = apiKeyModule;

    resetApiKeyCacheForTest();

    const app = express();
    registerReloadEndpoint(app, { readApiKeyFromRequest, isApiKeyValid, forceReloadApiKey, getCachedApiKeySnapshot }, 'secret-token');

    await request(app).post('/api/employees/active/reload-key').set('x-reload-token', 'secret-token').expect(200);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });

  it('rejects reload endpoint when neither token nor cached API key authorization is available', async () => {
    const apiKeyModule = await importApiKeyModule({
      EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS: '0',
    });
    const {
      forceReloadApiKey,
      getCachedApiKeySnapshot,
      isApiKeyValid,
      readApiKeyFromRequest,
      resetApiKeyCacheForTest,
      stopApiKeyRefreshScheduler,
    } = apiKeyModule;

    resetApiKeyCacheForTest();

    const app = express();
    registerReloadEndpoint(app, { readApiKeyFromRequest, isApiKeyValid, forceReloadApiKey, getCachedApiKeySnapshot });

    await request(app).post('/api/employees/active/reload-key').set('x-api-key', 'any-key').expect(401);

    stopApiKeyRefreshScheduler();
    resetApiKeyCacheForTest();
  });
});
