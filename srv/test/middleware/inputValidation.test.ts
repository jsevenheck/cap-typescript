import type { NextFunction, Request, Response } from 'express';
import { inputValidationMiddleware } from '../../middleware/inputValidation';

type MockResponse = Response & {
  statusCode?: number;
  jsonData?: unknown;
};

const createMockRequest = (overrides: Partial<Request> = {}): Request => {
  const req = {
    path: '/test',
    originalUrl: '/test',
    url: '/test',
    method: 'GET',
    headers: {},
    get: (name: string) => {
      const headers = (req as Request).headers || {};
      const value = headers[name.toLowerCase()];
      if (name.toLowerCase() === 'set-cookie' && typeof value === 'string') {
        return [value];
      }
      return value as string | string[] | undefined;
    },
    ...overrides,
  } as Request;

  return req;
};

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as MockResponse;

  // Capture status code and JSON data for assertions
  (res.status as jest.Mock).mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });

  (res.json as jest.Mock).mockImplementation((data: unknown) => {
    res.jsonData = data;
    return res;
  });

  return res;
};

describe('inputValidationMiddleware', () => {
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockNext = jest.fn();
  });

  describe('health check exemption', () => {
    it('should skip validation for health check endpoints', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({ path: '/health', originalUrl: '/health' });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should skip validation for health check sub-paths', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({ path: '/health/live', originalUrl: '/health/live' });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('URL length validation', () => {
    it('should allow URLs within the limit', () => {
      const middleware = inputValidationMiddleware({ maxUrlLength: 100 });
      const req = createMockRequest({ originalUrl: '/api/test' });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject URLs exceeding the maximum length', () => {
      const middleware = inputValidationMiddleware({ maxUrlLength: 10 });
      const longUrl = '/api/test/with/very/long/path';
      const req = createMockRequest({ originalUrl: longUrl });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(414);
      expect(res.jsonData).toMatchObject({
        error: 'URI Too Long',
        code: 414,
      });
    });

    it('should use default max URL length of 2048 bytes', () => {
      const middleware = inputValidationMiddleware();
      const longUrl = '/api/' + 'x'.repeat(2100);
      const req = createMockRequest({ originalUrl: longUrl });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(res.statusCode).toBe(414);
    });
  });

  describe('header size validation', () => {
    it('should allow headers within the size limit', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer token123',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject requests with headers exceeding the maximum size', () => {
      const middleware = inputValidationMiddleware({ maxHeaderSize: 100 });
      const req = createMockRequest({
        headers: {
          'x-large-header': 'x'.repeat(200),
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(431);
      expect(res.jsonData).toMatchObject({
        error: 'Request Header Fields Too Large',
        code: 431,
      });
    });

    it('should handle array-valued headers correctly', () => {
      const middleware = inputValidationMiddleware({ maxHeaderSize: 100 });
      const req = createMockRequest({
        headers: {
          'set-cookie': ['cookie1=value1', 'cookie2=value2'],
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Content-Type validation', () => {
    it('should require Content-Type for POST requests with Content-Length', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-length': '100',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.jsonData).toMatchObject({
        error: 'Bad Request',
        message: expect.stringContaining('Content-Type header is required'),
      });
    });

    it('should require Content-Type for PUT requests without explicit Content-Length: 0', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'PUT',
        headers: {},
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
    });

    it('should require Content-Type for PATCH requests without explicit Content-Length: 0', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'PATCH',
        headers: {},
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
    });

    it('should allow POST requests with Content-Length: 0 without Content-Type', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-length': '0',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should validate Content-Type against allowed types', () => {
      const middleware = inputValidationMiddleware({
        allowedContentTypes: ['application/json'],
      });
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'text/xml',
          'content-length': '100',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(415);
      expect(res.jsonData).toMatchObject({
        error: 'Unsupported Media Type',
      });
    });

    it('should accept valid Content-Type from allowed list', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '100',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle Content-Type with charset parameter', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': '100',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should not require Content-Type for GET requests', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'GET',
        headers: {},
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should not require Content-Type for DELETE requests', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'DELETE',
        headers: {},
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Content-Length validation', () => {
    it('should allow JSON payloads within the size limit', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '1000',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject JSON payloads exceeding the maximum size', () => {
      const middleware = inputValidationMiddleware({ maxJsonSize: 1000 });
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '2000',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(413);
      expect(res.jsonData).toMatchObject({
        error: 'Payload Too Large',
      });
    });

    it('should use default max JSON size of 1MB', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(2 * 1024 * 1024), // 2MB
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(res.statusCode).toBe(413);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle missing originalUrl by using url', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        originalUrl: undefined as unknown as string,
        url: '/fallback-url',
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow requests with Content-Type but without Content-Length header', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      // Content-Length validation is secondary - primary enforcement is via Express body parser
      // This middleware only validates if Content-Length is explicitly provided
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject malformed Content-Length values (NaN)', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': 'invalid',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: "Invalid 'Content-Length' header value",
        code: 400,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject negative Content-Length values', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '-100',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: "Invalid 'Content-Length' header value",
        code: 400,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle correlation ID in request context', () => {
      const middleware = inputValidationMiddleware({ maxUrlLength: 10 });
      const req = createMockRequest({
        originalUrl: '/very/long/url',
      }) as Request & { correlationId?: string };
      req.correlationId = 'test-correlation-id';
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(res.statusCode).toBe(414);
    });
  });

  describe('custom configuration', () => {
    it('should use custom maxUrlLength', () => {
      const middleware = inputValidationMiddleware({ maxUrlLength: 50 });
      const req = createMockRequest({ originalUrl: '/test' });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should use custom maxHeaderSize', () => {
      const middleware = inputValidationMiddleware({ maxHeaderSize: 500 });
      const req = createMockRequest({
        headers: { 'x-custom': 'value' },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should use custom maxJsonSize', () => {
      const middleware = inputValidationMiddleware({ maxJsonSize: 500 });
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '400',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should use custom allowedContentTypes', () => {
      const middleware = inputValidationMiddleware({
        allowedContentTypes: ['application/xml'],
      });
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/xml',
          'content-length': '100',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
