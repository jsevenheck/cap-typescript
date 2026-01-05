import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('input-validation');

/**
 * Maximum sizes for request payloads (in bytes)
 */
const MAX_JSON_SIZE = 1024 * 1024; // 1MB (matches cds server.body_parser.limit)
const MAX_URL_LENGTH = 2048; // 2KB for URL
const MAX_HEADER_SIZE = 8192; // 8KB for headers

/**
 * Input validation options
 */
export interface ValidationOptions {
  maxJsonSize?: number;
  maxUrlLength?: number;
  maxHeaderSize?: number;
  allowedContentTypes?: string[];
}

/**
 * Default allowed content types for API requests
 */
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

/**
 * Validates request size and format to prevent abuse
 * 
 * SAP CAP Best Practice: Always validate and limit request sizes
 * to prevent DoS attacks and resource exhaustion.
 * 
 * Validations:
 * - Request URL length
 * - Request header size
 * - Content-Type header (if body present)
 * - Content-Length header validation
 * 
 * @param options - Validation configuration options
 */
export function inputValidationMiddleware(options: ValidationOptions = {}) {
  const {
    maxJsonSize = MAX_JSON_SIZE,
    maxUrlLength = MAX_URL_LENGTH,
    maxHeaderSize = MAX_HEADER_SIZE,
    allowedContentTypes = DEFAULT_ALLOWED_CONTENT_TYPES,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Skip validation for health check endpoints
      if (req.path.startsWith('/health')) {
        next();
        return;
      }

      // Validate URL length
      const fullUrl = req.originalUrl || req.url;
      if (fullUrl.length > maxUrlLength) {
        logger.warn(
          {
            urlLength: fullUrl.length,
            maxUrlLength,
            path: req.path,
            correlationId: (req as { correlationId?: string }).correlationId,
          },
          'Request URL exceeds maximum length',
        );
        res.status(414).json({
          error: 'URI Too Long',
          message: `Request URL exceeds maximum allowed length of ${maxUrlLength} characters`,
          code: 414,
        });
        return;
      }

      // Validate header size (approximate)
      const headersSize = JSON.stringify(req.headers).length;
      if (headersSize > maxHeaderSize) {
        logger.warn(
          {
            headersSize,
            maxHeaderSize,
            path: req.path,
            correlationId: (req as { correlationId?: string }).correlationId,
          },
          'Request headers exceed maximum size',
        );
        res.status(431).json({
          error: 'Request Header Fields Too Large',
          message: `Request headers exceed maximum allowed size of ${maxHeaderSize} bytes`,
          code: 431,
        });
        return;
      }

      // Validate Content-Type for requests with body
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
        const contentType = req.get('content-type');
        
        // Check if Content-Type is present for body-bearing methods
        if (!contentType && req.get('content-length') && parseInt(req.get('content-length') || '0', 10) > 0) {
          logger.warn(
            {
              method: req.method,
              path: req.path,
              correlationId: (req as { correlationId?: string }).correlationId,
            },
            'Missing Content-Type header for request with body',
          );
          res.status(400).json({
            error: 'Bad Request',
            message: 'Content-Type header is required for requests with a body',
            code: 400,
          });
          return;
        }

        // Validate Content-Type against allowed types
        if (contentType) {
          const baseContentType = contentType.split(';')[0].trim().toLowerCase();
          const isAllowed = allowedContentTypes.some(
            allowed => baseContentType === allowed.toLowerCase() || baseContentType.startsWith(allowed.toLowerCase()),
          );

          if (!isAllowed) {
            logger.warn(
              {
                contentType: baseContentType,
                allowedTypes: allowedContentTypes,
                path: req.path,
                correlationId: (req as { correlationId?: string }).correlationId,
              },
              'Unsupported Content-Type',
            );
            res.status(415).json({
              error: 'Unsupported Media Type',
              message: `Content-Type '${baseContentType}' is not supported`,
              code: 415,
              supportedTypes: allowedContentTypes,
            });
            return;
          }
        }
      }

      // Validate Content-Length for JSON payloads
      const contentLength = req.get('content-length');
      const contentType = req.get('content-type');
      
      if (contentLength && contentType?.includes('application/json')) {
        const size = parseInt(contentLength, 10);
        if (size > maxJsonSize) {
          logger.warn(
            {
              contentLength: size,
              maxJsonSize,
              path: req.path,
              correlationId: (req as { correlationId?: string }).correlationId,
            },
            'JSON payload exceeds maximum size',
          );
          res.status(413).json({
            error: 'Payload Too Large',
            message: `JSON payload exceeds maximum allowed size of ${maxJsonSize} bytes`,
            code: 413,
          });
          return;
        }
      }

      // All validations passed
      next();
    } catch (error) {
      logger.error({ error, path: req.path }, 'Error during input validation');
      next(error);
    }
  };
}

/**
 * Sanitizes string input by removing potentially dangerous characters
 * Used for user-supplied strings that will be logged or displayed
 * 
 * @param input - The string to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove control characters and trim
  // eslint-disable-next-line no-control-regex -- Intentionally removing control characters for security
  const withoutControlChars = input.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  return withoutControlChars
    .replace(/[<>]/g, '') // Remove angle brackets
    .trim();
}

/**
 * Validates if a string is a valid UUID
 * 
 * @param value - The value to validate
 * @returns True if valid UUID, false otherwise
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validates if a string is a valid date in ISO 8601 format
 * 
 * @param value - The value to validate
 * @returns True if valid date, false otherwise
 */
export function isValidISODate(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  // Match ISO-like date strings and extract the date part (YYYY-MM-DD)
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  // Basic month range check
  if (month < 1 || month > 12) {
    return false;
  }

  // Days in each month, accounting for leap years in February
  const isLeapYear =
    (year % 4 === 0 && year % 100 !== 0) ||
    (year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (day < 1 || day > daysInMonth[month - 1]) {
    return false;
  }

  // Finally, ensure JavaScript can parse the full value as a date/time
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

/**
 * Default export
 */
export default inputValidationMiddleware;
