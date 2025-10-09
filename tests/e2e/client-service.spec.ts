import { expect, request, test } from '@playwright/test';
import { startCapServer } from '../utils/cap-server';

test('Client list is accessible for HR viewer scope', async () => {
  const server = await startCapServer();
  try {
    const context = await request.newContext({
      baseURL: server.url,
      extraHTTPHeaders: {
        Authorization: 'Basic ZGV2OmRldg==',
        'x-cds-roles': 'HRViewer',
        'x-cds-user': 'dev'
      }
    });

    try {
      const response = await context.get('/odata/v4/clients/Clients?$select=ID,name,companyId');
      const bodyText = await response.text();
      expect(response.status(), bodyText).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.value)).toBe(true);
      expect(body.value.length).toBeGreaterThan(0);
    } finally {
      await context.dispose();
    }
  } finally {
    await server.close();
  }
});

