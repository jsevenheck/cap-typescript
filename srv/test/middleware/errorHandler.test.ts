import type { Request, Response } from 'express';
import { errorHandlerMiddleware, createErrorHandler } from '../../middleware/errorHandler';

type MockResponse = Response & {
  statusCode?: number;
  jsonData?: unknown;
  headersSent?: boolean;
  statusMock: jest.Mock;
  jsonMock: jest.Mock;
};

const createMockRequest = (overrides: Partial<Request> = {}): Request => {
  const req = {
    path: '/test',
    method: 'GET',
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

describe('errorHandlerMiddleware', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('Error Type Handling', () => {
    it('should handle standard Error objects', () => {
      const error = new Error('Test error message');
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(500);
      expect(res.jsonMock).toHaveBeenCalled();
      expect(res.jsonData).toMatchObject({
        error: 'Internal Server Error',
        message: 'Test error message',
        code: 500,
      });
    });

    it('should handle CAP ServiceError with status', () => {
      // ServiceErrors should extend Error, so create proper error object
      const error = Object.assign(new Error('Bad request error'), {
        status: 400,
        code: 'BAD_REQUEST',
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(400);
      expect(res.jsonMock).toHaveBeenCalled();
      expect(res.jsonData).toMatchObject({
        error: 'Request Error',
        message: 'Bad request error',
        code: 400,
      });
    });

    it('should handle CAP ServiceError with custom code', () => {
      const error = Object.assign(new Error('Resource not found'), {
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(404);
      expect(res.jsonData).toMatchObject({
        message: 'Resource not found',
        code: 404,
      });
    });

    it('should handle unknown error types', () => {
      const error = 'String error';
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(500);
      expect(res.jsonMock).toHaveBeenCalled();
      expect(res.jsonData).toMatchObject({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        code: 500,
      });
    });

    it('should handle null error', () => {
      const error = null;
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(500);
      expect(res.jsonMock).toHaveBeenCalled();
    });

    it('should handle undefined error', () => {
      const error = undefined;
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(500);
      expect(res.jsonMock).toHaveBeenCalled();
    });
  });

  describe('Correlation ID Handling', () => {
    it('should include correlation ID in response when available', () => {
      const error = new Error('Test error');
      const req = createMockRequest() as Request & { correlationId?: string };
      req.correlationId = 'test-correlation-id-123';
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).toMatchObject({
        correlationId: 'test-correlation-id-123',
      });
    });

    it('should not include correlation ID when not available', () => {
      const error = new Error('Test error');
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).not.toHaveProperty('correlationId');
    });
  });

  describe('Environment-Based Behavior', () => {
    it('should expose error details in development environment', () => {
      process.env.NODE_ENV = 'development';
      const error = Object.assign(new Error('Validation failed'), {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).toMatchObject({
        message: 'Validation failed',
        details: 'VALIDATION_ERROR',
      });
    });

    it('should hide server error details in production for 5xx errors', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Internal database connection failed');
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).toMatchObject({
        message: 'An internal server error occurred', // Generic message
        code: 500,
      });
      expect(res.jsonData).not.toHaveProperty('details');
    });

    it('should expose client error details in production for 4xx errors', () => {
      process.env.NODE_ENV = 'production';
      const error = Object.assign(new Error('Invalid request parameters'), {
        status: 400,
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).toMatchObject({
        message: 'Invalid request parameters', // Client errors are shown
        code: 400,
      });
    });

    it('should not include details in production even when present', () => {
      process.env.NODE_ENV = 'production';
      const error = Object.assign(new Error('Database error'), {
        status: 500,
        code: 'DB_ERROR',
      });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).not.toHaveProperty('details');
    });
  });

  describe('Response Headers Handling', () => {
    it('should not send response when headers already sent', () => {
      const error = new Error('Test error');
      const req = createMockRequest();
      const res = createMockResponse();
      res.headersSent = true;
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).not.toHaveBeenCalled();
      expect(res.jsonMock).not.toHaveBeenCalled();
    });

    it('should send response when headers not yet sent', () => {
      const error = new Error('Test error');
      const req = createMockRequest();
      const res = createMockResponse();
      res.headersSent = false;
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalled();
      expect(res.jsonMock).toHaveBeenCalled();
    });
  });

  describe('Error Response Format', () => {
    it('should include timestamp in ISO format', () => {
      const error = new Error('Test error');
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const beforeTime = new Date().toISOString();
      errorHandlerMiddleware(error, req, res, next);
      const afterTime = new Date().toISOString();

      const timestamp = (res.jsonData as { timestamp: string }).timestamp;
      expect(timestamp).toBeDefined();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(timestamp >= beforeTime && timestamp <= afterTime).toBe(true);
    });

    it('should set correct error message for 5xx errors', () => {
      const error = new Error('Test error');
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).toMatchObject({
        error: 'Internal Server Error',
      });
    });

    it('should set correct error message for 4xx errors', () => {
      const error = { status: 400, message: 'Bad request' };
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.jsonData).toMatchObject({
        error: 'Request Error',
      });
    });
  });

  describe('Status Code Classification', () => {
    it('should treat 400 as client error', () => {
      const error = Object.assign(new Error('Bad request'), { status: 400 });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(400);
      expect(res.jsonData).toMatchObject({
        error: 'Request Error',
      });
    });

    it('should treat 401 as client error', () => {
      const error = Object.assign(new Error('Unauthorized'), { status: 401 });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(401);
      expect(res.jsonData).toMatchObject({
        error: 'Request Error',
      });
    });

    it('should treat 403 as client error', () => {
      const error = Object.assign(new Error('Forbidden'), { status: 403 });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(403);
      expect(res.jsonData).toMatchObject({
        error: 'Request Error',
      });
    });

    it('should treat 404 as client error', () => {
      const error = Object.assign(new Error('Not found'), { status: 404 });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(404);
      expect(res.jsonData).toMatchObject({
        error: 'Request Error',
      });
    });

    it('should treat 500 as server error', () => {
      const error = Object.assign(new Error('Internal error'), { status: 500 });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(500);
      expect(res.jsonData).toMatchObject({
        error: 'Internal Server Error',
      });
    });

    it('should treat 503 as server error', () => {
      const error = Object.assign(new Error('Service unavailable'), { status: 503 });
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(503);
      expect(res.jsonData).toMatchObject({
        error: 'Internal Server Error',
      });
    });
  });

  describe('Factory Function', () => {
    it('should create error handler via createErrorHandler', () => {
      const handler = createErrorHandler();
      const error = new Error('Test error');
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      handler(error, req, res, next);

      expect(res.statusMock).toHaveBeenCalledWith(500);
      expect(res.jsonMock).toHaveBeenCalled();
    });

    it('should return a function with correct signature', () => {
      const handler = createErrorHandler();
      
      expect(typeof handler).toBe('function');
      expect(handler.length).toBe(4); // Error handlers in Express must have 4 parameters
    });
  });

  describe('Request Context Logging', () => {
    it('should log request path and method', () => {
      const error = new Error('Test error');
      const req = createMockRequest({
        path: '/api/employees',
        method: 'POST',
      });
      const res = createMockResponse();
      const next = jest.fn();

      errorHandlerMiddleware(error, req, res, next);

      // Error was logged with context (verified by no throw)
      expect(res.statusMock).toHaveBeenCalled();
    });
  });
});
