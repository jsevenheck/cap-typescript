import { registerTenantIsolation } from '../../middleware/tenant-isolation';

const TENANT = 't-123';

describe('Tenant isolation middleware', () => {
  const captureHandlers = () => {
    const handlers: Record<string, ((req: any) => void)[]> = {};
    const srv = {
      before: (event: string | string[], _entities: string[], handler: (req: any) => void) => {
        const events = Array.isArray(event) ? event : [event];
        events.forEach((entry) => {
          handlers[entry] = handlers[entry] ?? [];
          handlers[entry].push(handler);
        });
      },
    } as any;

    registerTenantIsolation(srv);
    return handlers;
  };

  it('injects tenant into single and bulk create payloads', () => {
    const handlers = captureHandlers();
    const [createHandler] = handlers['CREATE'];

    const singleReq = { data: { ID: '1' }, tenant: TENANT, user: { tenant: TENANT } } as any;
    createHandler(singleReq);
    expect(singleReq.data.tenant).toBe(TENANT);

    const bulkReq = { data: [{ ID: '1' }, { ID: '2' }], tenant: TENANT, user: { tenant: TENANT } } as any;
    createHandler(bulkReq);
    expect(bulkReq.data.map((entry: any) => entry.tenant)).toEqual([TENANT, TENANT]);
  });

  it('appends tenant filter for read/update/delete queries without duplicating existing conditions', () => {
    const handlers = captureHandlers();
    const [guardHandler] = handlers['READ'];

    const selectQuery: any = {
      SELECT: {
        from: 'clientmgmt.Clients',
        where: [{ ref: ['ID'] }, '=', { val: '1' }],
      },
    };

    const req = { query: selectQuery, tenant: TENANT, user: { tenant: TENANT } } as any;
    guardHandler(req);

    expect(selectQuery.SELECT.where).toEqual([
      '(',
      { ref: ['ID'] },
      '=',
      { val: '1' },
      ')',
      'and',
      { ref: ['tenant'] },
      '=',
      { val: TENANT },
    ]);

    const alreadyScoped: any = {
      SELECT: {
        from: 'clientmgmt.Clients',
        where: [{ ref: ['tenant'] }, '=', { val: TENANT }],
      },
    };

    const scopedReq = { query: alreadyScoped, tenant: TENANT, user: { tenant: TENANT } } as any;
    guardHandler(scopedReq);
    expect(alreadyScoped.SELECT.where).toEqual([{ ref: ['tenant'] }, '=', { val: TENANT }]);
  });
});
