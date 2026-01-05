import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { createServiceError } from '../../shared/utils/errors';
import {
  extractEntityId,
  resolveAssociationId,
} from '../../shared/utils/associations';

interface LookupCache {
  clientIds: Map<string, string | null>;
  relationIds: Map<string, string | null>;
}

type EmployeeRow = {
  ID: string;
  client_ID: string;
  manager_ID?: string | null;
  costCenter_ID?: string | null;
  location_ID?: string | null;
};

type CostCenterRow = {
  ID: string;
  client_ID: string;
  responsible_ID: string;
};

type LocationRow = {
  ID: string;
  client_ID: string;
};

type RequestData = Record<string, unknown>;

// Type-safe query runner interface
interface QueryRunner {
  run<T = unknown>(query: unknown): Promise<T>;
}

const EMPLOYEES_ENTITY = 'clientmgmt.Employees';
const COST_CENTERS_ENTITY = 'clientmgmt.CostCenters';
const LOCATIONS_ENTITY = 'clientmgmt.Locations';
const { SELECT } = cds.ql;

export class IntegrityValidator {
  private readonly cache: LookupCache = {
    clientIds: new Map(),
    relationIds: new Map(),
  };
  private readonly runner: QueryRunner;

  constructor(req: Request) {
    const transaction = cds.tx(req);
    if (transaction && typeof (transaction as { run?: unknown }).run === 'function') {
      this.runner = transaction as QueryRunner;
    } else if (typeof (req as unknown as { run?: unknown }).run === 'function') {
      this.runner = req as unknown as QueryRunner;
    } else {
      throw createServiceError(500, 'Unable to obtain database runner for integrity validation.');
    }
  }

  /**
   * Validates employee relations ensuring managers and cost centers belong to the same client.
   */
  async validateEmployeeRelations(employees: RequestData[]): Promise<void> {
    if (!employees.length) {
      return;
    }

    const existingRecords = await this.loadExistingEmployees(employees);

    for (const employee of employees) {
      const employeeId = extractEntityId(employee);
      const existing = employeeId ? existingRecords.get(employeeId) : undefined;
      const clientId = resolveAssociationId(employee, 'client', existing?.client_ID);

      if (!clientId) {
        // Client association is mandatory at the entity definition level; validation here is defensive.
        throw createServiceError(400, 'Employee must reference a client.');
      }

      const managerId = resolveAssociationId(employee, 'manager', existing?.manager_ID ?? undefined);
      if (managerId) {
        const managerClientId = await this.fetchClientId(EMPLOYEES_ENTITY, managerId);
        if (managerClientId && managerClientId !== clientId) {
          throw createServiceError(
            400,
            `Manager ${managerId} belongs to a different client than the employee.`,
          );
        }
      }

      const costCenterId = resolveAssociationId(employee, 'costCenter', existing?.costCenter_ID ?? undefined);
      if (costCenterId) {
        const costCenterClientId = await this.fetchClientId(COST_CENTERS_ENTITY, costCenterId);
        if (costCenterClientId && costCenterClientId !== clientId) {
          throw createServiceError(
            400,
            `Cost center ${costCenterId} belongs to a different client than the employee.`,
          );
        }
      }

      const locationId = resolveAssociationId(employee, 'location', existing?.location_ID ?? undefined);
      if (locationId) {
        const locationClientId = await this.fetchClientId(LOCATIONS_ENTITY, locationId);
        if (locationClientId && locationClientId !== clientId) {
          throw createServiceError(
            400,
            `Location ${locationId} belongs to a different client than the employee.`,
          );
        }
      }
    }
  }

  /**
   * Validates location relations ensuring locations belong to a valid client.
   */
  async validateLocationRelations(locations: RequestData[]): Promise<void> {
    if (!locations.length) {
      return;
    }

    const existingRecords = await this.loadExistingLocations(locations);

    for (const location of locations) {
      const locationId = extractEntityId(location);
      const existing = locationId ? existingRecords.get(locationId) : undefined;
      const clientId = resolveAssociationId(location, 'client', existing?.client_ID);

      if (!clientId) {
        throw createServiceError(400, 'Location must reference a client.');
      }
    }
  }

  /**
   * Validates cost center responsible assignments ensuring responsible employees belong to the same client.
   */
  async validateCostCenterRelations(costCenters: RequestData[]): Promise<void> {
    if (!costCenters.length) {
      return;
    }

    const existingRecords = await this.loadExistingCostCenters(costCenters);

    for (const costCenter of costCenters) {
      const costCenterId = extractEntityId(costCenter);
      const existing = costCenterId ? existingRecords.get(costCenterId) : undefined;
      const clientId = resolveAssociationId(costCenter, 'client', existing?.client_ID);

      if (!clientId) {
        throw createServiceError(400, 'Cost center must reference a client.');
      }

      const responsibleId = resolveAssociationId(costCenter, 'responsible', existing?.responsible_ID);
      if (!responsibleId) {
        continue;
      }

      const responsibleClientId = await this.fetchClientId(EMPLOYEES_ENTITY, responsibleId);
      if (responsibleClientId && responsibleClientId !== clientId) {
        throw createServiceError(
          400,
          `Responsible employee ${responsibleId} belongs to a different client than the cost center.`,
        );
      }
    }
  }

  private async loadExistingEmployees(employees: RequestData[]): Promise<Map<string, EmployeeRow>> {
    const ids = employees
      .map((employee) => extractEntityId(employee))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run<EmployeeRow[]>(
      SELECT.from(EMPLOYEES_ENTITY)
        .columns('ID', 'client_ID', 'manager_ID', 'costCenter_ID', 'location_ID')
        .where({ ID: { in: ids } }),
    )) as EmployeeRow[];

    const map = new Map<string, EmployeeRow>();
    for (const row of rows) {
      map.set(row.ID, row);
      this.cache.clientIds.set(`${EMPLOYEES_ENTITY}:${row.ID}`, row.client_ID ?? null);
    }
    return map;
  }

  private async loadExistingLocations(locations: RequestData[]): Promise<Map<string, LocationRow>> {
    const ids = locations
      .map((location) => extractEntityId(location))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run<LocationRow[]>(
      SELECT.from(LOCATIONS_ENTITY)
        .columns('ID', 'client_ID')
        .where({ ID: { in: ids } }),
    )) as LocationRow[];

    const map = new Map<string, LocationRow>();
    for (const row of rows) {
      map.set(row.ID, row);
      this.cache.clientIds.set(`${LOCATIONS_ENTITY}:${row.ID}`, row.client_ID ?? null);
    }
    return map;
  }

  private async loadExistingCostCenters(costCenters: RequestData[]): Promise<Map<string, CostCenterRow>> {
    const ids = costCenters
      .map((costCenter) => extractEntityId(costCenter))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run<CostCenterRow[]>(
      SELECT.from(COST_CENTERS_ENTITY)
        .columns('ID', 'client_ID', 'responsible_ID')
        .where({ ID: { in: ids } }),
    )) as CostCenterRow[];

    const map = new Map<string, CostCenterRow>();
    for (const row of rows) {
      map.set(row.ID, row);
      this.cache.clientIds.set(`${COST_CENTERS_ENTITY}:${row.ID}`, row.client_ID ?? null);
    }
    return map;
  }

  private async fetchClientId(entityName: string, entityId: string): Promise<string | null> {
    if (!entityId) {
      return null;
    }

    const cacheKey = `${entityName}:${entityId}`;
    if (this.cache.clientIds.has(cacheKey)) {
      return this.cache.clientIds.get(cacheKey) ?? null;
    }

    const result = (await this.runner.run(
      SELECT.one.from(entityName).columns('client_ID').where({ ID: entityId }),
    )) as { client_ID?: string } | null;

    const clientId = result?.client_ID ?? null;
    this.cache.clientIds.set(cacheKey, clientId);
    return clientId;
  }
}

export const createIntegrityValidator = (req: Request): IntegrityValidator => new IntegrityValidator(req);

export default IntegrityValidator;
