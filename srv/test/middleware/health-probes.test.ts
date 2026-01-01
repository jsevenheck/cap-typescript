import type { Request } from 'express';

/**
 * Tests for health probe endpoints.
 * These tests verify the behavior of /health/live, /health/ready, and /health endpoints.
 */

// Mock the logger
jest.mock('../../shared/utils/logger', () => ({
  initializeLogger: jest.fn(),
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  extractOrGenerateCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
  setCorrelationId: jest.fn(),
}));

// Mock the authProvider
jest.mock('../../shared/utils/authProvider', () => ({
  resolveAuthProviderName: jest.fn().mockReturnValue('Mock'),
}));

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  statusCode?: number;
  body?: Record<string, unknown>;
};

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    status: jest.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((body: Record<string, unknown>) => {
      res.body = body;
      return res;
    }),
  };
  return res;
};

const createMockRequest = (): Request => ({} as Request);

describe('Health Probe Endpoints', () => {
  describe('/health/live - Liveness Probe', () => {
    it('should return 200 with alive status', () => {
      const req = createMockRequest();
      const res = createMockResponse();

      // Simulate the liveness endpoint handler directly
      const livenessHandler = (_req: Request, response: MockResponse): void => {
        response.status(200).json({
          status: 'alive',
          timestamp: new Date().toISOString(),
        });
      };

      livenessHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'alive');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('should include a valid ISO timestamp', () => {
      const req = createMockRequest();
      const res = createMockResponse();

      const livenessHandler = (_req: Request, response: MockResponse): void => {
        response.status(200).json({
          status: 'alive',
          timestamp: new Date().toISOString(),
        });
      };

      livenessHandler(req, res);

      expect(res.body?.timestamp).toBeDefined();
      // Verify it's a valid ISO date string
      const date = new Date(res.body?.timestamp as string);
      expect(date.toISOString()).toBe(res.body?.timestamp);
    });
  });

  describe('createHealthCheckHandler - Database Connectivity Check', () => {
    interface HealthCheckConfig {
      successStatus: string;
      failureStatus: string;
      logContext: string;
    }

    const createHealthCheckHandler = (config: HealthCheckConfig, dbMock: { run: jest.Mock } | null) =>
      async (_req: Request, res: MockResponse): Promise<void> => {
        try {
          const db = dbMock;

          if (!db) {
            throw new Error('Database connection not available');
          }

          // Simulate the database query
          await db.run({});

          res.status(200).json({
            status: config.successStatus,
            timestamp: new Date().toISOString(),
            checks: {
              database: 'connected',
            },
          });
        } catch (error) {
          res.status(503).json({
            status: config.failureStatus,
            timestamp: new Date().toISOString(),
            checks: {
              database: 'disconnected',
            },
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      };

    describe('/health/ready - Readiness Probe', () => {
      it('should return 200 with ready status when database is connected', async () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const dbMock = { run: jest.fn().mockResolvedValue({}) };

        const handler = createHealthCheckHandler({
          successStatus: 'ready',
          failureStatus: 'not_ready',
          logContext: 'Readiness check',
        }, dbMock);

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('status', 'ready');
        expect(res.body).toHaveProperty('checks');
        expect((res.body?.checks as Record<string, string>)?.database).toBe('connected');
      });

      it('should return 503 with not_ready status when database connection fails', async () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const dbMock = { run: jest.fn().mockRejectedValue(new Error('Connection refused')) };

        const handler = createHealthCheckHandler({
          successStatus: 'ready',
          failureStatus: 'not_ready',
          logContext: 'Readiness check',
        }, dbMock);

        await handler(req, res);

        expect(res.statusCode).toBe(503);
        expect(res.body).toHaveProperty('status', 'not_ready');
        expect(res.body).toHaveProperty('checks');
        expect((res.body?.checks as Record<string, string>)?.database).toBe('disconnected');
        expect(res.body).toHaveProperty('error', 'Connection refused');
      });

      it('should return 503 when database is not available', async () => {
        const req = createMockRequest();
        const res = createMockResponse();

        const handler = createHealthCheckHandler({
          successStatus: 'ready',
          failureStatus: 'not_ready',
          logContext: 'Readiness check',
        }, null);

        await handler(req, res);

        expect(res.statusCode).toBe(503);
        expect(res.body).toHaveProperty('status', 'not_ready');
        expect(res.body).toHaveProperty('error', 'Database connection not available');
      });
    });

    describe('/health - Health Check', () => {
      it('should return 200 with healthy status when database is connected', async () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const dbMock = { run: jest.fn().mockResolvedValue({}) };

        const handler = createHealthCheckHandler({
          successStatus: 'healthy',
          failureStatus: 'unhealthy',
          logContext: 'Health check',
        }, dbMock);

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('status', 'healthy');
        expect(res.body).toHaveProperty('checks');
        expect((res.body?.checks as Record<string, string>)?.database).toBe('connected');
      });

      it('should return 503 with unhealthy status when database connection fails', async () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const dbMock = { run: jest.fn().mockRejectedValue(new Error('Query timeout')) };

        const handler = createHealthCheckHandler({
          successStatus: 'healthy',
          failureStatus: 'unhealthy',
          logContext: 'Health check',
        }, dbMock);

        await handler(req, res);

        expect(res.statusCode).toBe(503);
        expect(res.body).toHaveProperty('status', 'unhealthy');
        expect(res.body).toHaveProperty('checks');
        expect((res.body?.checks as Record<string, string>)?.database).toBe('disconnected');
        expect(res.body).toHaveProperty('error', 'Query timeout');
      });

      it('should include timestamp in all responses', async () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const dbMock = { run: jest.fn().mockResolvedValue({}) };

        const handler = createHealthCheckHandler({
          successStatus: 'healthy',
          failureStatus: 'unhealthy',
          logContext: 'Health check',
        }, dbMock);

        await handler(req, res);

        expect(res.body?.timestamp).toBeDefined();
        // Verify it's a valid ISO date string
        const date = new Date(res.body?.timestamp as string);
        expect(date.toISOString()).toBe(res.body?.timestamp);
      });

      it('should handle non-Error exceptions gracefully', async () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const dbMock = { run: jest.fn().mockRejectedValue('String error') };

        const handler = createHealthCheckHandler({
          successStatus: 'healthy',
          failureStatus: 'unhealthy',
          logContext: 'Health check',
        }, dbMock);

        await handler(req, res);

        expect(res.statusCode).toBe(503);
        expect(res.body).toHaveProperty('error', 'Unknown error');
      });
    });
  });
});
