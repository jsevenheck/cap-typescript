/** Error helpers for creating CAP-compatible ServiceError instances. */
export interface CapServiceError extends Error {
  status: number;
  statusCode?: number;
  code?: string | number;
}

/**
 * Creates a ServiceError with the provided HTTP status and message.
 */
export const createServiceError = (status: number, message?: string): CapServiceError => {
  const error: CapServiceError = new Error(message ?? `HTTP ${status}`) as CapServiceError;
  error.name = 'ServiceError';
  error.status = status;
  error.statusCode = status;
  error.code = status;
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
