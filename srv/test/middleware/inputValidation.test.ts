import type { Request, Response } from 'express';
import { inputValidationMiddleware } from '../../middleware/inputValidation';

type MockResponse = Response & {
  statusCode?: number;
  jsonData?: unknown;
  statusMock: jest.Mock;
  jsonMock: jest.Mock;
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
  const statusMock = jest.fn().mockReturnThis();
  const jsonMock = jest.fn().mockReturnThis();
  const res: MockResponse = {
    status: statusMock,
    json: jsonMock,
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
      expect(res.statusMock).not.toHaveBeenCalled();
    });

    it('should skip validation for health check sub-paths', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({ path: '/health/live', originalUrl: '/health/live' });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.statusMock).not.toHaveBeenCalled();
    });
  });

  describe('URL length validation', () => {
    it('should allow URLs within the limit', () => {
      const middleware = inputValidationMiddleware({ maxUrlLength: 100 });
      const req = createMockRequest({ originalUrl: '/api/test' });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.statusMock).not.toHaveBeenCalled();
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
      expect(res.statusMock).not.toHaveBeenCalled();
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
      expect(res.statusMock).not.toHaveBeenCalled();
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
      expect(res.statusMock).not.toHaveBeenCalled();
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

      expect(res.statusMock).toHaveBeenCalledWith(400);
      expect(res.jsonMock).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: "Invalid 'Content-Length' header value",
        code: 400,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject Infinity Content-Length values', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': 'Infinity',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(res.statusMock).toHaveBeenCalledWith(400);
      expect(res.jsonMock).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: "Invalid 'Content-Length' header value",
        code: 400,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject -Infinity Content-Length values', () => {
      const middleware = inputValidationMiddleware();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '-Infinity',
        },
      });
      const res = createMockResponse();

      middleware(req, res, mockNext);

      expect(res.statusMock).toHaveBeenCalledWith(400);
      expect(res.jsonMock).toHaveBeenCalledWith({
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

      expect(res.statusMock).toHaveBeenCalledWith(400);
      expect(res.jsonMock).toHaveBeenCalledWith({
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

  describe('Combined limit scenarios', () => {
    it('should handle all three limits at maximum simultaneously', () => {
      // Test with max URL (2KB), near-max headers (7KB), and near-max payload (900KB)
      // This validates behavior when multiple size limits are approached together
      const maxUrlLength = 2048;
      const largeUrl = '/api/test?' + 'x'.repeat(maxUrlLength - 20);
      
      // Create large but valid headers (below 8KB limit)
      const largeHeaderValue = 'h'.repeat(1000);
      const largeHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'content-length': '900000', // 900KB - near 1MB limit
        'x-custom-1': largeHeaderValue,
        'x-custom-2': largeHeaderValue,
        'x-custom-3': largeHeaderValue,
        'x-custom-4': largeHeaderValue,
        'x-custom-5': largeHeaderValue,
        'x-custom-6': largeHeaderValue,
      };

      const req = createMockRequest({
        method: 'POST',
        originalUrl: largeUrl,
        headers: largeHeaders,
      });
      const res = createMockResponse();

      const middleware = inputValidationMiddleware();
      middleware(req, res, mockNext);

      // All limits are approached but not exceeded, so request should pass
      expect(mockNext).toHaveBeenCalled();
      expect(res.statusMock).not.toHaveBeenCalled();
    });

    it('should reject when URL exceeds limit with large headers and payload', () => {
      // Test rejection when URL exceeds limit even with other large values
      const tooLongUrl = '/api/test?' + 'x'.repeat(3000); // Exceeds 2KB
      
      const largeHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'content-length': '900000',
        'x-custom': 'h'.repeat(1000),
      };

      const req = createMockRequest({
        method: 'POST',
        originalUrl: tooLongUrl,
        headers: largeHeaders,
      });
      const res = createMockResponse();

      const middleware = inputValidationMiddleware();
      middleware(req, res, mockNext);

      // URL limit exceeded - should reject before checking other limits
      expect(res.statusMock).toHaveBeenCalledWith(414);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject when headers exceed limit with large URL and payload', () => {
      // Test rejection when headers exceed limit even with other large values
      const largeUrl = '/api/test?' + 'x'.repeat(1900);
      
      // Create a single very large header that exceeds 8KB limit (8192 bytes)
      const veryLargeHeaderValue = 'h'.repeat(9000); // Single header > 8KB
      const tooLargeHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'content-length': '900000',
        'x-very-large-custom-header': veryLargeHeaderValue,
      };

      const req = createMockRequest({
        method: 'POST',
        originalUrl: largeUrl,
        path: '/api/test', // Explicitly set path to avoid any issues
        headers: tooLargeHeaders,
      });
      const res = createMockResponse();

      const middleware = inputValidationMiddleware();
      middleware(req, res, mockNext);

      // Headers limit exceeded - should reject with 431 (Request Header Fields Too Large)
      expect(res.statusMock).toHaveBeenCalledWith(431);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject when payload exceeds limit with large URL and headers', () => {
      // Test rejection when payload exceeds limit even with other large values
      const largeUrl = '/api/test?' + 'x'.repeat(1900);
      
      const largeHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'content-length': '2000000', // 2MB - exceeds 1MB limit
        'x-custom': 'h'.repeat(1000),
      };

      const req = createMockRequest({
        method: 'POST',
        originalUrl: largeUrl,
        headers: largeHeaders,
      });
      const res = createMockResponse();

      const middleware = inputValidationMiddleware();
      middleware(req, res, mockNext);

      // Payload limit exceeded - should reject
      expect(res.statusMock).toHaveBeenCalledWith(413);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
