import cds from '@sap/cds';

const { GET } = cds.test(__dirname + '/../../');

describe('Health endpoint', () => {
  it('returns healthy status with database connectivity', async () => {
    const response = await GET('/health');

    expect(response.status).toBe(200);
    expect(response.data).toEqual(
      expect.objectContaining({
        status: 'healthy',
        checks: expect.objectContaining({ database: 'connected' }),
      }),
    );
  });
});
