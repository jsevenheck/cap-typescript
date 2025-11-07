import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { IntegrityValidator } from '../../../domain/shared/integrity-handler';

type EntityMap = Record<string, Record<string, any>>;

const EMPLOYEES_ENTITY = 'clientmgmt.Employees';
const COST_CENTERS_ENTITY = 'clientmgmt.CostCenters';
const transactionSpy = jest.spyOn(cds, 'transaction');

const extractEntity = (query: any): string => {
  const from = query?.SELECT?.from;
  if (!from) {
    return '';
  }
  if (typeof from === 'string') {
    return from;
  }
  if (Array.isArray(from.ref)) {
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

const createMockRequest = (entities: EntityMap): Request => {
  const run = jest.fn(async (query: any) => {
    const entity = extractEntity(query);
    const ids = extractIds(query);
    const isOne = Boolean(query?.SELECT?.one);

    if (!entity) {
      return null;
    }

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

  return { run } as unknown as Request;
};

describe('IntegrityValidator', () => {
  afterEach(() => {
    transactionSpy.mockReset();
  });

  afterAll(() => {
    transactionSpy.mockRestore();
  });

  it('accepts employees whose manager and cost center belong to the same client', async () => {
    const entities: EntityMap = {
      [EMPLOYEES_ENTITY]: {
        emp1: { ID: 'emp1', client_ID: 'client1', manager_ID: 'mgr1', costCenter_ID: 'cc1' },
        mgr1: { ID: 'mgr1', client_ID: 'client1' },
      },
      [COST_CENTERS_ENTITY]: {
        cc1: { ID: 'cc1', client_ID: 'client1', responsible_ID: 'mgr1' },
      },
    };

    const req = createMockRequest(entities);
    const runMock = (req as unknown as { run: jest.Mock }).run;
    const validator = new IntegrityValidator(req);

    await expect(
      validator.validateEmployeeRelations([
        { ID: 'emp1', client_ID: 'client1', manager_ID: 'mgr1', costCenter_ID: 'cc1' },
      ]),
    ).resolves.toBeUndefined();

    // Expect only a single query to resolve the manager and cost center client IDs due to caching
    const managerCalls = runMock.mock.calls.filter((call) =>
      extractIds(call[0]).includes('mgr1'),
    );
    const costCenterCalls = runMock.mock.calls.filter((call) =>
      extractIds(call[0]).includes('cc1'),
    );

    expect(managerCalls).toHaveLength(1);
    expect(costCenterCalls).toHaveLength(1);
  });

  it('rejects employees referencing a manager from a different client', async () => {
    const entities: EntityMap = {
      [EMPLOYEES_ENTITY]: {
        emp1: { ID: 'emp1', client_ID: 'client1', manager_ID: 'mgr2' },
        mgr2: { ID: 'mgr2', client_ID: 'client2' },
      },
      [COST_CENTERS_ENTITY]: {},
    };

    const req = createMockRequest(entities);
    const validator = new IntegrityValidator(req);

    await expect(
      validator.validateEmployeeRelations([
        { ID: 'emp1', client_ID: 'client1', manager_ID: 'mgr2' },
      ]),
    ).rejects.toThrow('Manager mgr2 belongs to a different client than the employee.');
  });

  it('rejects employees referencing a cost center from a different client', async () => {
    const entities: EntityMap = {
      [EMPLOYEES_ENTITY]: {
        emp1: { ID: 'emp1', client_ID: 'client1', costCenter_ID: 'cc2' },
      },
      [COST_CENTERS_ENTITY]: {
        cc2: { ID: 'cc2', client_ID: 'client2', responsible_ID: 'mgr3' },
      },
    };

    const req = createMockRequest(entities);
    const validator = new IntegrityValidator(req);

    await expect(
      validator.validateEmployeeRelations([
        { ID: 'emp1', client_ID: 'client1', costCenter_ID: 'cc2' },
      ]),
    ).rejects.toThrow('Cost center cc2 belongs to a different client than the employee.');
  });

  it('ignores null references when validating employees', async () => {
    const entities: EntityMap = {
      [EMPLOYEES_ENTITY]: {
        emp1: { ID: 'emp1', client_ID: 'client1', manager_ID: null, costCenter_ID: null },
      },
      [COST_CENTERS_ENTITY]: {},
    };

    const req = createMockRequest(entities);
    const validator = new IntegrityValidator(req);

    await expect(
      validator.validateEmployeeRelations([
        { ID: 'emp1', client_ID: 'client1', manager_ID: null, costCenter_ID: null },
      ]),
    ).resolves.toBeUndefined();
  });

  it('validates cost centers to ensure responsible employees belong to the same client', async () => {
    const entities: EntityMap = {
      [EMPLOYEES_ENTITY]: {
        mgr1: { ID: 'mgr1', client_ID: 'client1' },
      },
      [COST_CENTERS_ENTITY]: {
        cc1: { ID: 'cc1', client_ID: 'client1', responsible_ID: 'mgr1' },
      },
    };

    const req = createMockRequest(entities);
    const validator = new IntegrityValidator(req);

    await expect(
      validator.validateCostCenterRelations([
        { ID: 'cc1', client_ID: 'client1', responsible_ID: 'mgr1' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects cost centers whose responsible employee belongs to a different client', async () => {
    const entities: EntityMap = {
      [EMPLOYEES_ENTITY]: {
        mgr2: { ID: 'mgr2', client_ID: 'client2' },
      },
      [COST_CENTERS_ENTITY]: {
        cc1: { ID: 'cc1', client_ID: 'client1', responsible_ID: 'mgr2' },
      },
    };

    const req = createMockRequest(entities);
    const validator = new IntegrityValidator(req);

    await expect(
      validator.validateCostCenterRelations([
        { ID: 'cc1', client_ID: 'client1', responsible_ID: 'mgr2' },
      ]),
    ).rejects.toThrow('Responsible employee mgr2 belongs to a different client than the cost center.');
  });
});
