jest.mock('../../../../domain/client/repository/client.repo', () => ({
  findClientById: jest.fn(),
}));

jest.mock('../../../../domain/cost-center/repository/cost-center.repo', () => ({
  findCostCenterById: jest.fn(),
}));

jest.mock('../../../../domain/employee/repository/employee.repo', () => ({
  findEmployeeById: jest.fn(),
}));

import { findClientById } from '../../../../domain/client/repository/client.repo';
import { findCostCenterById } from '../../../../domain/cost-center/repository/cost-center.repo';
import { findEmployeeById } from '../../../../domain/employee/repository/employee.repo';
import {
  enforceCostCenterRelations,
  enforceEmployeeRelations,
} from '../../../../domain/shared/integrity/client-integrity.service';

const mockFindClientById = findClientById as jest.MockedFunction<typeof findClientById>;
const mockFindCostCenterById = findCostCenterById as jest.MockedFunction<typeof findCostCenterById>;
const mockFindEmployeeById = findEmployeeById as jest.MockedFunction<typeof findEmployeeById>;

const tx = {} as any;

describe('client-integrity.service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('enforceCostCenterRelations', () => {
    it('validates responsible employee against the same client', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);
      mockFindEmployeeById.mockResolvedValue({ ID: 'EMP-1', client_ID: 'CLIENT-1' } as any);

      await expect(
        enforceCostCenterRelations(tx, [
          { client_ID: 'CLIENT-1', responsible_ID: 'EMP-1' },
        ]),
      ).resolves.toBeUndefined();
    });

    it('derives missing client from existing cost center', async () => {
      mockFindCostCenterById.mockResolvedValue({ ID: 'COST-1', client_ID: 'CLIENT-9', responsible_ID: 'EMP-9' } as any);
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-9', companyId: 'COMP-009' } as any);
      mockFindEmployeeById.mockResolvedValue({ ID: 'EMP-9', client_ID: 'CLIENT-9' } as any);

      await expect(enforceCostCenterRelations(tx, [{ ID: 'COST-1' }])).resolves.toBeUndefined();
      expect(mockFindCostCenterById).toHaveBeenCalledWith(tx, 'COST-1', ['ID', 'client_ID', 'responsible_ID']);
    });

    it('throws when responsible employee belongs to another client', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);
      mockFindEmployeeById.mockResolvedValue({ ID: 'EMP-1', client_ID: 'CLIENT-2' } as any);

      await expect(
        enforceCostCenterRelations(tx, [{ client_ID: 'CLIENT-1', responsible_ID: 'EMP-1' }]),
      ).rejects.toMatchObject({ code: 'REFERENTIAL_INTEGRITY' });
    });
  });

  describe('enforceEmployeeRelations', () => {
    it('validates cost center and manager assignments', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);
      mockFindCostCenterById.mockResolvedValue({ ID: 'COST-1', client_ID: 'CLIENT-1' } as any);
      mockFindEmployeeById.mockResolvedValue({ ID: 'MANAGER-1', client_ID: 'CLIENT-1' } as any);

      await expect(
        enforceEmployeeRelations(tx, [
          { client_ID: 'CLIENT-1', costCenter_ID: 'COST-1', manager_ID: 'MANAGER-1' },
        ]),
      ).resolves.toBeUndefined();
    });

    it('loads employee context when client is not provided', async () => {
      mockFindEmployeeById.mockResolvedValueOnce({ ID: 'EMP-1', client_ID: 'CLIENT-1' } as any);
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);

      await expect(enforceEmployeeRelations(tx, [{ ID: 'EMP-1' }])).resolves.toBeUndefined();
      expect(mockFindEmployeeById).toHaveBeenCalledWith(tx, 'EMP-1', ['ID', 'client_ID']);
    });

    it('rejects mismatched cost centers', async () => {
      mockFindEmployeeById.mockResolvedValueOnce({ ID: 'EMP-1', client_ID: 'CLIENT-1' } as any);
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);
      mockFindCostCenterById.mockResolvedValue({ ID: 'COST-1', client_ID: 'CLIENT-2' } as any);

      await expect(
        enforceEmployeeRelations(tx, [{ ID: 'EMP-1', costCenter_ID: 'COST-1' }]),
      ).rejects.toMatchObject({ code: 'REFERENTIAL_INTEGRITY' });
    });

    it('rejects managers from other clients', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);
      mockFindEmployeeById.mockImplementation(async (_tx, id) => {
        if (id === 'MANAGER-2') {
          return { ID: 'MANAGER-2', client_ID: 'CLIENT-2' } as any;
        }
        return { ID: id, client_ID: 'CLIENT-1' } as any;
      });

      await expect(
        enforceEmployeeRelations(tx, [
          { client_ID: 'CLIENT-1', manager_ID: 'MANAGER-2' },
        ]),
      ).rejects.toMatchObject({ code: 'REFERENTIAL_INTEGRITY' });
    });
  });
});
