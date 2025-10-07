import type { Application } from 'express';

declare namespace CDSQL {
  interface BaseQuery<T = unknown> {
    columns(...columns: string[]): BaseQuery<T>;
    where(condition: Record<string, unknown>): BaseQuery<T>;
  }

  interface SelectBuilder {
    from(entity: string): BaseQuery;
  }

  interface InsertBuilder {
    entries(entity: Record<string, unknown>): Promise<unknown>;
  }

  interface UpdateBuilder {
    set(values: Record<string, unknown>): BaseQuery;
  }

  interface QL {
    SELECT: {
      from(entity: string): BaseQuery;
      one: {
        from(entity: string): BaseQuery;
      };
    };
    INSERT: {
      into(entity: string): InsertBuilder;
    };
    UPDATE(entity: string): UpdateBuilder;
  }
}

declare namespace CDS {
  interface Request {
    readonly event: string;
    data: Record<string, any>;
    error(status: number, message: string): void;
    reject(status: number, message?: string): never;
  }

  interface Service {
    before(
      events: string | string[],
      entity: string,
      handler: (req: Request) => void | Promise<void>,
    ): void;
  }

  interface Transaction {
    run<T = unknown>(query: unknown): Promise<T>;
  }

  interface DeployResult {
    to(target: string): Promise<void>;
  }

  interface CDSInstance {
    ql: CDSQL.QL;
    env: {
      features: Record<string, unknown>;
    };
    service: {
      impl(handler: (service: Service) => void | Promise<void>): unknown;
    };
    transaction(req: Request): Transaction;
    deploy(model: string | string[]): DeployResult;
    readonly server: Promise<Application>;
    on(event: string, listener: (app: Application) => void): void;
  }
}

declare module '@sap/cds' {
  const cds: CDS.CDSInstance;
  export default cds;
  export type Request = CDS.Request;
  export type Service = CDS.Service;
}
