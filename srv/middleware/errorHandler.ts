import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('error-handler');

/**
 * Structured error response format
 */
interface ErrorResponse {
  error: string;
  message: string;
  code: number;
  details?: unknown;
  timestamp: string;
  correlationId?: string;
}

/**
 * Extract meaningful error information from various error types
 */
function extractErrorInfo(error: unknown): { status: number; message: string; details?: unknown } {
  // CAP ServiceError with status
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    return {
      status: error.status,
      message: error instanceof Error ? error.message : 'An error occurred',
      details: 'code' in error ? error.code : undefined,
    };
  }

  // Standard Error
  if (error instanceof Error) {
    return {
      status: 500,
      message: error.message,
    };
  }

  // Unknown error type
  return {
    status: 500,
    message: 'An unexpected error occurred',
  };
}

/**
 * Global error handling middleware for Express
 * 
 * SAP CAP Best Practice: Centralize error handling to ensure consistent
 * error responses and proper logging of all errors.
 * 
 * Features:
 * - Consistent error response format
 * - Correlation ID tracking
 * - Structured error logging
 * - Sensitive information protection in production
 * 
 * @param err - The error object
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): void {
  // Check if response headers have already been sent
  if (res.headersSent) {
    logger.warn({ path: req.path, method: req.method }, 'Error occurred after response headers sent');
    return;
  }

  const { status, message, details } = extractErrorInfo(err);
  const correlationId = (req as { correlationId?: string }).correlationId;

  // Log error with context
  const logContext = {
    status,
    message,
    details,
    correlationId,
    path: req.path,
    method: req.method,
    error: err,
  };

  if (status >= 500) {
    logger.error(logContext, 'Server error occurred');
  } else {
    logger.warn(logContext, 'Client error occurred');
  }

  // Build error response
  const errorResponse: ErrorResponse = {
    error: status >= 500 ? 'Internal Server Error' : 'Request Error',
    message: process.env.NODE_ENV === 'production' && status >= 500
      ? 'An internal server error occurred'
      : message,
    code: status,
    timestamp: new Date().toISOString(),
  };

  // Include correlation ID if available
  if (correlationId) {
    errorResponse.correlationId = correlationId;
  }

  // Include details in non-production environments for debugging
  if (process.env.NODE_ENV !== 'production' && details) {
    errorResponse.details = details;
  }

  res.status(status).json(errorResponse);
}

/**
 * Creates a typed error handler middleware for better type safety
 */
export function createErrorHandler(): (err: unknown, req: Request, res: Response, next: NextFunction) => void {
  return errorHandlerMiddleware;
}

/**
 * Default export
 */
export default errorHandlerMiddleware;
