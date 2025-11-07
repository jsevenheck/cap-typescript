import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import {
  CompanyAuthorization,
} from '../../middleware/company-authorization';

type EntityMap = Record<string, Record<string, any>>;

const CLIENTS_ENTITY = 'clientmgmt.Clients';
const EMPLOYEES_ENTITY = 'clientmgmt.Employees';
const COST_CENTERS_ENTITY = 'clientmgmt.CostCenters';
const transactionSpy = jest.spyOn(cds, 'transaction');

interface MockUser {
  is?: (role: string) => boolean;
  attr?: ((name: string) => unknown) | Record<string, unknown>;
}

const extractEntity = (query: any): string => {
  const from = query?.SELECT?.from;
  if (typeof from === 'string') {
    return from;
  }
  if (from && Array.isArray(from.ref)) {
    return from.ref.join('.');
  }
  return '';
};

const extractIds = (query: any): string[] => {
  const where = query?.SELECT?.where;
  if (!Array.isArray(where)) {
    return [];
  }

  const listEntry = where.find((part: any) => part && typeof part === 'object' && Array.isArray(part.list));
  if (listEntry) {
    return listEntry.list
      .map((entry: any) => (entry && typeof entry === 'object' ? entry.val : undefined))
      .filter((value: unknown): value is string => typeof value === 'string');
  }

  const valueEntry = where.find((part: any) => part && typeof part === 'object' && 'val' in part);
  if (valueEntry && typeof valueEntry.val === 'string') {
    return [valueEntry.val];
  }

  return [];
};

const createMockRequest = (user: MockUser, entities: EntityMap): Request => {
  const run = jest.fn(async (query: any) => {
    const entity = extractEntity(query);
    const ids = extractIds(query);
    const isOne = Boolean(query?.SELECT?.one);

    const store = entities[entity];
    if (!store) {
      return isOne ? null : [];
    }

    if (Array.isArray(ids) && ids.length > 1) {
      return ids
        .map((id) => store[id])
        .filter((row): row is Record<string, unknown> => Boolean(row));
    }

    const id = ids[0];
    if (id) {
      return isOne ? store[id] ?? null : store[id] ? [store[id]] : [];
    }

    const values = Object.values(store);
    return isOne ? values[0] ?? null : values;
  });

  transactionSpy.mockImplementationOnce(() => ({
    run,
    commit: jest.fn(),
    rollback: jest.fn(),
  }));

  return { user, run } as unknown as Request;
};

const createUser = (roles: string[], companies: string[] = []): MockUser => ({
  is: (role: string) => roles.includes(role),
  attr: {
    CompanyCode: companies,
    companyCodes: companies,
  },
});

describe('CompanyAuthorization', () => {
  afterEach(() => {
    transactionSpy.mockReset();
  });

  afterAll(() => {
    transactionSpy.mockRestore();
  });

  it('skips authorization checks for HRAdmin users', async () => {
    const user = createUser(['HRAdmin'], []);
    const req = createMockRequest(user, {});
    const runMock = (req as unknown as { run: jest.Mock }).run;
    const authorization = new CompanyAuthorization(req);

    expect(authorization.shouldSkip()).toBe(true);
    await expect(authorization.validateClientAccess([{ companyId: 'COMP-999' }])).resolves.toBeUndefined();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('allows HREditor users to modify clients in assigned companies', async () => {
    const user = createUser(['HREditor'], ['COMP-001']);
    const req = createMockRequest(user, {
      [CLIENTS_ENTITY]: {
        existing: { ID: 'existing', companyId: 'COMP-001' },
      },
    });

    const authorization = new CompanyAuthorization(req);

    await expect(
      authorization.validateClientAccess([
        { companyId: 'COMP-001' },
        { ID: 'existing' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects operations when no company assignments are provided', async () => {
    const user: MockUser = {
      is: (role: string) => role === 'HREditor',
      attr: {},
    };
    const req = createMockRequest(user, {});
    const authorization = new CompanyAuthorization(req);

    await expect(
      authorization.validateClientAccess([
        { companyId: 'COMP-001' },
      ]),
    ).rejects.toThrow('Forbidden: user has no assigned company codes.');
  });

  it('blocks client modifications for unauthorized companies', async () => {
    const user = createUser(['HREditor'], ['COMP-001']);
    const req = createMockRequest(user, {
      [CLIENTS_ENTITY]: {
        existing: { ID: 'existing', companyId: 'COMP-002' },
      },
    });

    const authorization = new CompanyAuthorization(req);

    await expect(
      authorization.validateClientAccess([
        { ID: 'existing' },
      ]),
    ).rejects.toThrow('Forbidden: not authorized to modify client existing for company COMP-002.');
  });

  it('allows employee operations for assigned companies', async () => {
    const user = createUser(['HREditor'], ['COMP-001']);
    const req = createMockRequest(user, {
      [CLIENTS_ENTITY]: {
        client1: { ID: 'client1', companyId: 'COMP-001' },
      },
      [EMPLOYEES_ENTITY]: {
        emp1: { ID: 'emp1', client_ID: 'client1' },
      },
    });

    const authorization = new CompanyAuthorization(req);

    await expect(
      authorization.validateEmployeeAccess([
        { ID: 'emp1' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('blocks employee operations for unassigned companies', async () => {
    const user = createUser(['HREditor'], ['COMP-001']);
    const req = createMockRequest(user, {
      [CLIENTS_ENTITY]: {
        client2: { ID: 'client2', companyId: 'COMP-002' },
      },
      [EMPLOYEES_ENTITY]: {
        emp2: { ID: 'emp2', client_ID: 'client2' },
      },
    });

    const authorization = new CompanyAuthorization(req);

    await expect(
      authorization.validateEmployeeAccess([
        { ID: 'emp2' },
      ]),
    ).rejects.toThrow('Forbidden: not authorized to modify employee emp2 for company COMP-002.');
  });

  it('enforces cost center authorization based on client company assignments', async () => {
    const user = createUser(['HRViewer', 'HREditor'], ['COMP-001']);
    const req = createMockRequest(user, {
      [CLIENTS_ENTITY]: {
        client1: { ID: 'client1', companyId: 'COMP-001' },
      },
      [COST_CENTERS_ENTITY]: {
        cc1: { ID: 'cc1', client_ID: 'client1' },
      },
    });

    const authorization = new CompanyAuthorization(req);

    await expect(
      authorization.validateCostCenterAccess([
        { ID: 'cc1' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('blocks cost center operations for unauthorized companies', async () => {
    const user = createUser(['HREditor'], ['COMP-001']);
    const req = createMockRequest(user, {
      [CLIENTS_ENTITY]: {
        client2: { ID: 'client2', companyId: 'COMP-002' },
      },
      [COST_CENTERS_ENTITY]: {
        cc2: { ID: 'cc2', client_ID: 'client2' },
      },
    });

    const authorization = new CompanyAuthorization(req);

    await expect(
      authorization.validateCostCenterAccess([
        { ID: 'cc2' },
      ]),
    ).rejects.toThrow('Forbidden: not authorized to modify cost center cc2 for company COMP-002.');
  });
});
