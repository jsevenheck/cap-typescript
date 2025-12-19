import express from 'express';
import request from 'supertest';

import apiKeyMiddleware, { forceReloadApiKey, loadApiKey, stopApiKeyRefreshScheduler } from '../../middleware/apiKey';

let currentApiKey = 'initial-key';

jest.mock('../../shared/utils/secrets', () => ({
  __esModule: true,
  getEmployeeExportApiKey: jest.fn(async () => currentApiKey),
}));

const createApp = () => {
  const app = express();
  app.get('/api/employees/active', apiKeyMiddleware, (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
};

describe('apiKeyMiddleware', () => {
  afterEach(() => {
    stopApiKeyRefreshScheduler();
  });

  it('accepts rotated API keys without restarting the server', async () => {
    const app = createApp();

    await loadApiKey({ force: true, reason: 'test-initial-load' });

    await request(app).get('/api/employees/active').set('x-api-key', 'initial-key').expect(200);

    currentApiKey = 'rotated-key';
    await forceReloadApiKey();

    await request(app).get('/api/employees/active').set('x-api-key', 'initial-key').expect(401);
    await request(app).get('/api/employees/active').set('x-api-key', 'rotated-key').expect(200);
  });
});
