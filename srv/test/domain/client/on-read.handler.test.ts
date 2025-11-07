import type { Request } from '@sap/cds';

import { onRead } from '../../../domain/client/handlers/on-read';

type TestRequest = Request & { query: { SELECT: { where?: unknown[] } } };

describe('client onRead handler', () => {
  const createUser = (roles: string[], companies?: string[]) => ({
    is: (role: string) => roles.includes(role),
    attr: (name: string) => {
      if (!companies) {
        return undefined;
      }
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return companies;
      }
      return undefined;
    },
  });

  const createRequest = (user: unknown, where?: unknown[]): TestRequest =>
    ({
      user,
      query: { SELECT: { where } },
    } as unknown as TestRequest);

  it('allows HR administrators to read without filtering', async () => {
    const next = jest.fn().mockResolvedValue('ok');
    const req = createRequest(createUser(['HRAdmin'], ['COMP-001']));

    await expect(onRead(req, next)).resolves.toBe('ok');
    expect(next).toHaveBeenCalled();
    expect((req.query as any).SELECT.where).toBeUndefined();
  });

  it('applies company filters for authorized users', async () => {
    const next = jest.fn().mockResolvedValue('done');
    const req = createRequest(createUser(['HRViewer'], ['COMP-001', 'comp-002']));

    await expect(onRead(req, next)).resolves.toBe('done');
    const where = (req.query as any).SELECT.where as unknown[];
    expect(where).toEqual([
      { ref: ['companyId'] },
      'in',
      { list: [{ val: 'COMP-001' }, { val: 'COMP-002' }] },
    ]);
  });

  it('combines existing filters with company restrictions', async () => {
    const next = jest.fn().mockResolvedValue('done');
    const existingWhere = [{ ref: ['name'] }, '=', { val: 'Acme' }];
    const req = createRequest(createUser(['HREditor'], ['COMP-003']), existingWhere.slice());

    await expect(onRead(req, next)).resolves.toBe('done');
    const where = (req.query as any).SELECT.where as unknown[];
    expect(where).toEqual([
      '(',
      ...existingWhere,
      ')',
      'and',
      { ref: ['companyId'] },
      'in',
      { list: [{ val: 'COMP-003' }] },
    ]);
  });

  it('rejects users without company assignments', async () => {
    const next = jest.fn();
    const req = createRequest(createUser(['HRViewer'], undefined));

    await expect(onRead(req, next)).rejects.toMatchObject({ code: 'UNAUTHORIZED_COMPANY' });
    expect(next).not.toHaveBeenCalled();
  });
});
