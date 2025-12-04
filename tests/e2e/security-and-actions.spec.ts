import { expect, request, test } from '@playwright/test';

import { startCapServer } from '../utils/cap-server';

test.describe('Role-based behavior and secure endpoints', () => {
  test('viewer can read but editor can create client records', async () => {
    const server = await startCapServer();
    const viewerAuth = 'Basic aHJ2aWV3ZXI6aHJ2aWV3ZXI='; // hrviewer:hrviewer
    const editorAuth = 'Basic aHJlZGl0b3I6aHJlZGl0b3I='; // hreditor:hreditor

    const viewer = await request.newContext({
      baseURL: server.url,
      extraHTTPHeaders: {
        Authorization: viewerAuth,
        'x-cds-roles': 'HRViewer',
        'x-cds-user': 'hrviewer',
      },
    });

    const editor = await request.newContext({
      baseURL: server.url,
      extraHTTPHeaders: {
        Authorization: editorAuth,
        'x-cds-roles': 'HREditor',
        'x-cds-user': 'hreditor',
      },
    });

    try {
      const listResponse = await viewer.get('/odata/v4/clients/Clients?$top=1');
      expect(listResponse.status()).toBe(200);

      const viewerCreate = await viewer.post('/odata/v4/clients/Clients', {
        data: { companyId: 'COMP-200', name: 'Viewer Forbidden Co' },
      });
      expect(viewerCreate.status()).toBe(403);

      const editorCreate = await editor.post('/odata/v4/clients/Clients', {
        data: { companyId: 'COMP-201', name: 'Editor Allowed Co' },
      });
      expect(editorCreate.status()).toBe(201);
      const created = await editorCreate.json();
      expect(created.ID).toBeTruthy();
    } finally {
      await viewer.dispose();
      await editor.dispose();
      await server.close();
    }
  });

  test('API key protected endpoint returns errors without valid credentials', async () => {
    const server = await startCapServer();
    const context = await request.newContext({
      baseURL: server.url,
    });

    try {
      const missingKey = await context.get('/api/employees/active');
      expect(missingKey.status()).toBe(401);

      const wrongKey = await context.get('/api/employees/active', {
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(wrongKey.status()).toBe(401);
    } finally {
      await context.dispose();
      await server.close();
    }
  });

  test('anonymization action validates input and returns counts', async () => {
    const server = await startCapServer();
    const adminContext = await request.newContext({
      baseURL: server.url,
      extraHTTPHeaders: {
        Authorization: 'Basic ZGV2OmRldg==',
        'x-cds-roles': 'HRAdmin',
        'x-cds-user': 'dev',
      },
    });

    try {
      const invalidDate = await adminContext.post('/odata/v4/clients/anonymizeFormerEmployees', {
        data: { before: 'not-a-date' },
      });
      expect(invalidDate.status()).toBe(400);

      const validRequest = await adminContext.post('/odata/v4/clients/anonymizeFormerEmployees', {
        data: { before: '2099-01-01' },
      });
      expect(validRequest.status()).toBe(200);
      const body = await validRequest.json();
      expect(typeof body.value).toBe('number');
    } finally {
      await adminContext.dispose();
      await server.close();
    }
  });
});
