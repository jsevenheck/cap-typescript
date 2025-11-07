/** Error helpers for creating CAP-compatible ServiceError instances. */
export interface CapServiceError extends Error {
  status: number;
  statusCode?: number;
  code?: string | number;
}

const deriveStatusForCode = (code: string): number => {
  switch (code) {
    case 'UNAUTHORIZED_COMPANY':
      return 403;
    case 'REFERENTIAL_INTEGRITY':
      return 400;
    default:
      return 400;
  }
};

/**
 * Creates a ServiceError with the provided HTTP status/code and message.
 */
export const createServiceError = (statusOrCode: number | string, message?: string): CapServiceError => {
  const isStatusNumber = typeof statusOrCode === 'number';
  const status = isStatusNumber ? statusOrCode : deriveStatusForCode(statusOrCode);
  const code = isStatusNumber ? statusOrCode : statusOrCode;
  const fallbackMessage = isStatusNumber ? `HTTP ${status}` : statusOrCode;
  const error: CapServiceError = new Error(message ?? fallbackMessage) as CapServiceError;
  error.name = 'ServiceError';
  error.status = status;
  error.statusCode = status;
  error.code = code;
  if (Error.captureStackTrace) {
    Error.captureStackTrace(error, createServiceError);
  }
  return error;
};

/**
 * Utility helper to throw a CAP ServiceError with the given status and optional message.
 */
export const throwServiceError = (status: number, message?: string): never => {
  throw createServiceError(status, message);
};
