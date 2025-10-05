export {};

declare global {
  namespace THREE {
    interface Object3D {
      uuid?: string;
      name?: string;
      [key: string]: unknown;
    }

    interface Material {
      uuid?: string;
      name?: string;
      [key: string]: unknown;
    }

    interface Box3 {
      min?: { x?: number; y?: number; z?: number };
      max?: { x?: number; y?: number; z?: number };
      [key: string]: unknown;
    }

    interface Scene extends Object3D {}

    interface Quaternion {
      x?: number;
      y?: number;
      z?: number;
      w?: number;
      [key: string]: unknown;
    }
  }

  namespace JQuery {
    interface Event {
      preventDefault(): void;
      stopPropagation(): void;
      [key: string]: unknown;
    }

    interface Promise<TResolve = unknown, TReject = unknown, TNotify = unknown> extends PromiseLike<TResolve> {}

    interface Deferred<TResolve = unknown, TReject = unknown, TNotify = unknown> extends PromiseLike<TResolve> {
      resolve(value?: TResolve | PromiseLike<TResolve>): Deferred<TResolve, TReject, TNotify>;
      reject(reason?: TReject): Deferred<TResolve, TReject, TNotify>;
      notify?(value?: TNotify): Deferred<TResolve, TReject, TNotify>;
      promise(): Promise<TResolve, TReject, TNotify>;
    }
  }

  namespace globalThis {
    interface Assert {
      ok(value: unknown, message?: string): void;
      equal(actual: unknown, expected: unknown, message?: string): void;
      strictEqual(actual: unknown, expected: unknown, message?: string): void;
      deepEqual?(actual: unknown, expected: unknown, message?: string): void;
    }
  }
}
