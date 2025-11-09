/**
 * Utility for managing abortable requests with timeout support
 */

export interface AbortableRequestOptions {
  /**
   * Timeout in milliseconds (default: 30000 = 30 seconds)
   */
  timeout?: number;

  /**
   * Optional AbortController to use (creates new one if not provided)
   */
  controller?: AbortController;

  /**
   * Callback when request times out
   */
  onTimeout?: () => void;

  /**
   * Callback when request is aborted
   */
  onAbort?: () => void;
}

export interface AbortableRequestResult<T> {
  /**
   * The promise that resolves with the result or rejects on error/timeout/abort
   */
  promise: Promise<T>;

  /**
   * Controller to manually abort the request
   */
  controller: AbortController;

  /**
   * Cancel the request and cleanup
   */
  cancel: () => void;

  /**
   * Cleanup timeout (called automatically on resolution/rejection)
   */
  cleanup: () => void;
}

/**
 * Wrap a promise with timeout and abort capabilities
 *
 * @example
 * ```typescript
 * const { promise, cancel } = createAbortableRequest(
 *   model.submitBatch("$auto"),
 *   {
 *     timeout: 30000,
 *     onTimeout: () => MessageBox.error("Request timed out")
 *   }
 * );
 *
 * try {
 *   await promise;
 *   console.log("Success!");
 * } catch (error) {
 *   if (error.name === 'AbortError') {
 *     console.log("Request was cancelled");
 *   }
 * } finally {
 *   cancel(); // Always cleanup
 * }
 * ```
 */
export function createAbortableRequest<T>(
  requestPromise: Promise<T>,
  options: AbortableRequestOptions = {}
): AbortableRequestResult<T> {
  const {
    timeout = 30000,
    controller = new AbortController(),
    onTimeout,
    onAbort,
  } = options;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isResolved = false;

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        const timeoutError = new Error(
          `Request timed out after ${timeout}ms. Please check your network connection and try again.`
        );
        timeoutError.name = "TimeoutError";
        controller.abort(timeoutError);
        onTimeout?.();
        reject(timeoutError);
      }
    }, timeout);
  });

  // Listen for abort signal
  controller.signal.addEventListener("abort", () => {
    if (!isResolved) {
      onAbort?.();
    }
  });

  // Cleanup function
  const cleanup = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  // Cancel function
  const cancel = () => {
    cleanup();
    if (!isResolved) {
      const abortError = new Error("Request was cancelled by user");
      abortError.name = "AbortError";
      controller.abort(abortError);
    }
  };

  // Race the request against timeout
  const promise = Promise.race([requestPromise, timeoutPromise])
    .then((result) => {
      isResolved = true;
      cleanup();
      return result;
    })
    .catch((error) => {
      isResolved = true;
      cleanup();
      throw error;
    });

  return {
    promise,
    controller,
    cancel,
    cleanup,
  };
}

/**
 * Create multiple abortable requests that can be cancelled together
 *
 * @example
 * ```typescript
 * const manager = createRequestManager();
 *
 * const request1 = manager.add(fetchData1());
 * const request2 = manager.add(fetchData2());
 *
 * try {
 *   const [result1, result2] = await Promise.all([
 *     request1.promise,
 *     request2.promise
 *   ]);
 * } catch (error) {
 *   // Handle error
 * } finally {
 *   manager.cancelAll(); // Cleanup all requests
 * }
 * ```
 */
export class RequestManager {
  private requests: Set<AbortableRequestResult<any>> = new Set();

  /**
   * Add a request to the manager
   */
  public add<T>(
    requestPromise: Promise<T>,
    options?: AbortableRequestOptions
  ): AbortableRequestResult<T> {
    const request = createAbortableRequest(requestPromise, options);

    this.requests.add(request);

    // Auto-remove when completed
    request.promise
      .then(() => this.requests.delete(request))
      .catch(() => this.requests.delete(request));

    return request;
  }

  /**
   * Cancel all pending requests
   */
  public cancelAll(): void {
    for (const request of this.requests) {
      request.cancel();
    }
    this.requests.clear();
  }

  /**
   * Get number of pending requests
   */
  public get pendingCount(): number {
    return this.requests.size;
  }

  /**
   * Check if there are any pending requests
   */
  public get hasPending(): boolean {
    return this.requests.size > 0;
  }
}
