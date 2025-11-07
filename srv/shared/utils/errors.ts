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

/**
 * Error Builder - Convenience methods for creating common HTTP errors
 */
export class ErrorBuilder {
  /**
   * Create a 400 Bad Request error
   *
   * @param message - Error message
   * @param details - Optional additional details
   * @returns ServiceError with status 400
   */
  static badRequest(message: string, details?: unknown): CapServiceError {
    const error = createServiceError(400, message);
    if (details) {
      Object.assign(error, { details });
    }
    return error;
  }

  /**
   * Create a 401 Unauthorized error
   *
   * @param message - Error message (default: 'Unauthorized')
   * @returns ServiceError with status 401
   */
  static unauthorized(message: string = 'Unauthorized'): CapServiceError {
    return createServiceError(401, message);
  }

  /**
   * Create a 403 Forbidden error
   *
   * @param message - Error message (default: 'Forbidden')
   * @returns ServiceError with status 403
   */
  static forbidden(message: string = 'Forbidden'): CapServiceError {
    return createServiceError(403, message);
  }

  /**
   * Create a 404 Not Found error
   *
   * @param entity - Entity type (e.g., 'Employee', 'Client')
   * @param id - Entity identifier
   * @returns ServiceError with status 404
   */
  static notFound(entity: string, id: string): CapServiceError {
    return createServiceError(404, `${entity} with ID '${id}' not found`);
  }

  /**
   * Create a 409 Conflict error
   *
   * @param message - Error message
   * @returns ServiceError with status 409
   */
  static conflict(message: string): CapServiceError {
    return createServiceError(409, message);
  }

  /**
   * Create a 412 Precondition Failed error (for optimistic locking)
   *
   * @param message - Error message (default: 'Precondition Failed')
   * @returns ServiceError with status 412
   */
  static preconditionFailed(message: string = 'Precondition Failed'): CapServiceError {
    return createServiceError(412, message);
  }

  /**
   * Create a 422 Unprocessable Entity error (for validation failures)
   *
   * @param message - Error message
   * @param validationErrors - Optional validation error details
   * @returns ServiceError with status 422
   */
  static unprocessableEntity(message: string, validationErrors?: unknown): CapServiceError {
    const error = createServiceError(422, message);
    if (validationErrors) {
      Object.assign(error, { validationErrors });
    }
    return error;
  }

  /**
   * Create a 500 Internal Server Error
   *
   * @param message - Error message (default: 'Internal Server Error')
   * @returns ServiceError with status 500
   */
  static internalServerError(message: string = 'Internal Server Error'): CapServiceError {
    return createServiceError(500, message);
  }
}

