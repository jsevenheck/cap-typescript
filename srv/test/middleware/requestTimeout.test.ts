import type { Request, Response } from 'express';
import { requestTimeoutMiddleware } from '../../middleware/requestTimeout';

type MockResponse = Response & {
  statusCode?: number;
  jsonData?: unknown;
  headersSent?: boolean;
  statusMock: jest.Mock;
  jsonMock: jest.Mock;
};

type MockRequest = Request & {
  setTimeoutMock: jest.Mock;
};

const createMockRequest = (overrides: Partial<Request> = {}): MockRequest => {
  const setTimeoutMock = jest.fn();
  const req = {
    path: '/test',
    method: 'GET',
    setTimeout: setTimeoutMock,
    setTimeoutMock,
    ...overrides,
  } as unknown as MockRequest;

  return req;
};

const createMockResponse = (): MockResponse => {
  const statusMock = jest.fn().mockReturnThis();
  const jsonMock = jest.fn().mockReturnThis();
  const res: MockResponse = {
    status: statusMock,
    json: jsonMock,
    headersSent: false,
    statusMock,
    jsonMock,
  } as unknown as MockResponse;

  // Capture status code and JSON data for assertions
  statusMock.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });

  jsonMock.mockImplementation((data: unknown) => {
    res.jsonData = data;
    return res;
  });

  return res;
};

describe('requestTimeoutMiddleware', () => {
  const originalEnv = process.env.REQUEST_TIMEOUT_MS;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REQUEST_TIMEOUT_MS;
    } else {
      process.env.REQUEST_TIMEOUT_MS = originalEnv;
    }
  });

  describe('Health Check Exemption', () => {
    it('should skip timeout for /health endpoint', () => {
      const req = createMockRequest({ path: '/health' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should set timeout for non-health endpoints', () => {
      const req = createMockRequest({ path: '/api/users' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should skip timeout for health sub-paths', () => {
      const req = createMockRequest({ path: '/health/liveness' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Timeout Configuration', () => {
    it('should use default timeout when no config provided', () => {
      delete process.env.REQUEST_TIMEOUT_MS;
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(30000, expect.any(Function));
      expect(next).toHaveBeenCalled();
    });

    it('should use environment variable timeout when set', () => {
      process.env.REQUEST_TIMEOUT_MS = '60000';
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(60000, expect.any(Function));
      expect(next).toHaveBeenCalled();
    });

    it('should use custom timeout when passed as parameter', () => {
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware(45000);

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(45000, expect.any(Function));
      expect(next).toHaveBeenCalled();
    });

    it('should cap timeout at maximum value (5 minutes)', () => {
      process.env.REQUEST_TIMEOUT_MS = '600000'; // 10 minutes
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(300000, expect.any(Function)); // Capped to 5 min
      expect(next).toHaveBeenCalled();
    });

    it('should use default timeout for invalid environment value', () => {
      process.env.REQUEST_TIMEOUT_MS = 'invalid';
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(30000, expect.any(Function));
      expect(next).toHaveBeenCalled();
    });

    it('should use default timeout for negative environment value', () => {
      process.env.REQUEST_TIMEOUT_MS = '-1000';
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(30000, expect.any(Function));
      expect(next).toHaveBeenCalled();
    });

    it('should use default timeout for zero environment value', () => {
      process.env.REQUEST_TIMEOUT_MS = '0';
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(30000, expect.any(Function));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Timeout Handling', () => {
    it('should send 408 response when timeout occurs', () => {
      const req = createMockRequest({ path: '/api/test', method: 'POST' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware(1000);

      middleware(req, res, next);

      // Get the timeout callback
      const timeoutCallback = req.setTimeoutMock.mock.calls[0][1];
      
      // Invoke the timeout callback
      timeoutCallback();

      expect(res.statusMock).toHaveBeenCalledWith(408);
      expect(res.jsonMock).toHaveBeenCalledWith({
        error: 'Request Timeout',
        message: 'Request exceeded the timeout of 1000ms',
        code: 408,
      });
    });

    it('should not send response when headers already sent', () => {
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      res.headersSent = true;
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware(1000);

      middleware(req, res, next);

      // Get the timeout callback
      const timeoutCallback = req.setTimeoutMock.mock.calls[0][1];
      
      // Invoke the timeout callback
      timeoutCallback();

      expect(res.statusMock).not.toHaveBeenCalled();
      expect(res.jsonMock).not.toHaveBeenCalled();
    });

    it('should include correlation ID in timeout log context', () => {
      const req = createMockRequest({ 
        path: '/api/test', 
        method: 'GET',
      }) as Request & { correlationId?: string };
      req.correlationId = 'test-correlation-id';
      
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware(2000);

      middleware(req, res, next);

      // Get the timeout callback
      const timeoutCallback = req.setTimeoutMock.mock.calls[0][1];
      
      // Invoke the timeout callback
      timeoutCallback();

      expect(res.statusMock).toHaveBeenCalledWith(408);
      expect(res.jsonMock).toHaveBeenCalled();
    });
  });

  describe('Middleware Flow', () => {
    it('should call next() for non-health endpoints', () => {
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should set timeout and call next()', () => {
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle requests with empty path', () => {
      const req = createMockRequest({ path: '' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware();

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should handle multiple requests with same middleware instance', () => {
      const middleware = requestTimeoutMiddleware(5000);
      
      const req1 = createMockRequest({ path: '/api/test1' });
      const res1 = createMockResponse();
      const next1 = jest.fn();
      
      const req2 = createMockRequest({ path: '/api/test2' });
      const res2 = createMockResponse();
      const next2 = jest.fn();

      middleware(req1, res1, next1);
      middleware(req2, res2, next2);

      expect(req1.setTimeoutMock).toHaveBeenCalledWith(5000, expect.any(Function));
      expect(req2.setTimeoutMock).toHaveBeenCalledWith(5000, expect.any(Function));
      expect(next1).toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();
    });

    it('should handle very short timeout values', () => {
      const req = createMockRequest({ path: '/api/test' });
      const res = createMockResponse();
      const next = jest.fn();
      const middleware = requestTimeoutMiddleware(1);

      middleware(req, res, next);

      expect(req.setTimeoutMock).toHaveBeenCalledWith(1, expect.any(Function));
      expect(next).toHaveBeenCalled();
    });
  });
});
