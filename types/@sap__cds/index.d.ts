import type { Application } from 'express';
import type { CapUserLike } from '../../srv/shared/utils/auth';

declare module '@sap/cds' {
  export interface Request {
    data?: unknown;
    headers?: Record<string, unknown>;
    params?: unknown;
    target?: unknown;
    query?: unknown;
    event?: string;
    user?: CapUserLike;
    reject: (code: number, message?: string) => never | void | Promise<never | void>;
    error: (code: number, message?: string) => never | void | Promise<never | void>;
    [key: string]: any;
  }

  export interface Service {
    name?: string;
    entities?: Record<string, unknown>;
    on(event: string | string[], entity: string | ((req: Request) => unknown), handler?: (req: Request) => unknown): this;
    before(event: string | string[], entity: string | ((req: Request) => unknown), handler?: (req: Request) => unknown): this;
    after(event: string | string[], entity: string | ((req: Request) => unknown), handler?: (req: Request) => unknown): this;
    transaction(req: Request): Transaction;
    [key: string]: any;
  }

  export interface Transaction {
    entities?: Record<string, any>;
    run<T = unknown>(query: unknown): Promise<T>;
    commit?: () => Promise<void>;
    rollback?: () => Promise<void>;
    [key: string]: any;
  }

  export interface DeployResult {
    to(target: string): Promise<void>;
  }

  export interface CDSQL {
    SELECT: any;
    INSERT: any;
    UPDATE: any;
    DELETE: any;
    [key: string]: any;
  }

  export interface CDSConnectAPI {
    to(name: string): Promise<unknown>;
  }

  export interface CDSInstance {
    ql: CDSQL;
    env: { features: Record<string, unknown> };
    service: { impl(handler: (service: Service) => void | Promise<void>): unknown };
    transaction(req: Request): Transaction;
    connect: CDSConnectAPI;
    deploy(model: string | string[]): DeployResult;
    readonly server: Promise<Application>;
    on(event: string, listener: (app: Application) => void): void;
    [key: string]: any;
  }

  const cds: CDSInstance;
  export = cds;
}
