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
  }

  export interface Service {
    on(event: string | string[], entity: string | ((req: Request) => unknown), handler?: (req: Request) => unknown): void;
    before(event: string | string[], entity: string | ((req: Request) => unknown), handler?: (req: Request) => unknown): void;
    after(event: string | string[], entity: string | ((req: Request) => unknown), handler?: (req: Request) => unknown): void;
    transaction(req: Request): Transaction;
  }

  export interface Transaction {
    run<T = unknown>(query: unknown): Promise<T>;
  }

  export interface DeployResult {
    to(target: string): Promise<void>;
  }

  export interface CDSQL {
    SELECT: any;
    INSERT?: any;
    UPDATE?: any;
    DELETE?: any;
    [key: string]: any;
  }

  export interface CDSInstance {
    ql: CDSQL;
    env: { features: Record<string, unknown> };
    service: { impl(handler: (service: Service) => void | Promise<void>): unknown };
    transaction(req: Request): Transaction;
    deploy(model: string | string[]): DeployResult;
    readonly server: Promise<Application>;
    on(event: string, listener: (app: Application) => void): void;
  }

  const cds: CDSInstance;
  export = cds;
}
