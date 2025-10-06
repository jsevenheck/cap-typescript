declare module '@sap/cds' {
  export interface Request {
    readonly event: string;
    data: Record<string, unknown>;
    error(status: number, message: string): void;
  }

  export interface Service {
    before(
      events: string | string[],
      entity: string,
      handler: (req: Request) => void | Promise<void>
    ): void;
    run<T = unknown>(query: unknown): Promise<T>;
    transaction(): Transaction;
  }

  export interface Transaction {
    run<T = unknown>(query: unknown): Promise<T>;
    commit(): Promise<void>;
  }

  export interface DeployResult {
    to(target: string): Promise<void>;
  }

  interface SelectWhereBuilder {
    where(condition: Record<string, unknown>): unknown;
  }

  interface SelectColumnsBuilder extends SelectWhereBuilder {
    columns(...columns: string[]): SelectWhereBuilder;
  }

  interface SelectFromBuilder extends SelectColumnsBuilder {}

  interface UpdateBuilder {
    set(values: Record<string, unknown>): SelectWhereBuilder;
  }

  interface TestClient {
    defaults: {
      auth?: { username: string; password: string };
      headers: { common: Record<string, string> };
    };
    get<T = unknown>(url: string): Promise<{ status: number; data: T }>;
    post<T = unknown>(url: string, data?: unknown): Promise<{ status: number; data: T }>;
    expect: any;
  }

  export interface CDSInstance {
    ql: {
      SELECT: {
        from(entity: string): SelectColumnsBuilder;
        one: {
          from(entity: string): SelectColumnsBuilder;
        };
      };
      INSERT: {
        into(entity: string): {
          entries(record: Record<string, unknown>): Promise<unknown>;
        };
      };
      UPDATE(entity: string): UpdateBuilder;
    };
    env: {
      features: Record<string, unknown>;
    };
    service: {
      impl(handler: (service: Service) => void | Promise<void>): unknown;
    };
    connect: {
      to(name: string): Promise<Service>;
    };
    disconnect(name: string): Promise<void>;
    exec(...args: string[]): Promise<{ server: import('http').Server; url: string }>;
    transaction(req: Request): Transaction;
    deploy(model: string | string[]): DeployResult;
    readonly server: Promise<import('express').Application>;
    on(event: string, listener: (app: import('express').Application) => void): void;
    test(project?: string): TestClient;
  }

  const cds: CDSInstance;
  export default cds;
}
