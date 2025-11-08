import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { createServiceError } from '../../shared/utils/errors';

interface LookupCache {
  clientIds: Map<string, string | null>;
  relationIds: Map<string, string | null>;
}

type EmployeeRow = {
  ID: string;
  client_ID: string;
  manager_ID?: string | null;
  costCenter_ID?: string | null;
};

type CostCenterRow = {
  ID: string;
  client_ID: string;
  responsible_ID: string;
};

const EMPLOYEES_ENTITY = 'clientmgmt.Employees';
const COST_CENTERS_ENTITY = 'clientmgmt.CostCenters';
const { SELECT } = cds.ql;

export class IntegrityValidator {
  private readonly cache: LookupCache = {
    clientIds: new Map(),
    relationIds: new Map(),
  };
  private readonly runner: { run: (query: any) => Promise<any> };

  constructor(req: Request) {
    const transaction = cds.transaction(req);
    if (transaction && typeof (transaction as { run?: unknown }).run === 'function') {
      this.runner = transaction as { run: (query: any) => Promise<any> };
    } else if (typeof (req as unknown as { run?: unknown }).run === 'function') {
      this.runner = req as unknown as { run: (query: any) => Promise<any> };
    } else {
      throw createServiceError(500, 'Unable to obtain database runner for integrity validation.');
    }
  }

  /**
   * Validates employee relations ensuring managers and cost centers belong to the same client.
   */
  async validateEmployeeRelations(employees: any[]): Promise<void> {
    if (!employees.length) {
      return;
    }

    const existingRecords = await this.loadExistingEmployees(employees);

    for (const employee of employees) {
      const employeeId = this.extractId(employee);
      const existing = employeeId ? existingRecords.get(employeeId) : undefined;
      const clientId = this.resolveClientId(employee, existing?.client_ID);

      if (!clientId) {
        // Client association is mandatory at the entity definition level; validation here is defensive.
        throw createServiceError(400, 'Employee must reference a client.');
      }

      const managerId = this.resolveRelationId(employee, 'manager', existing?.manager_ID ?? undefined);
      if (managerId) {
        const managerClientId = await this.fetchClientId(EMPLOYEES_ENTITY, managerId);
        if (managerClientId && managerClientId !== clientId) {
          throw createServiceError(
            400,
            `Manager ${managerId} belongs to a different client than the employee.`,
          );
        }
      }

      const costCenterId = this.resolveRelationId(employee, 'costCenter', existing?.costCenter_ID ?? undefined);
      if (costCenterId) {
        const costCenterClientId = await this.fetchClientId(COST_CENTERS_ENTITY, costCenterId);
        if (costCenterClientId && costCenterClientId !== clientId) {
          throw createServiceError(
            400,
            `Cost center ${costCenterId} belongs to a different client than the employee.`,
          );
        }
      }
    }
  }

  /**
   * Validates cost center responsible assignments ensuring responsible employees belong to the same client.
   */
  async validateCostCenterRelations(costCenters: any[]): Promise<void> {
    if (!costCenters.length) {
      return;
    }

    const existingRecords = await this.loadExistingCostCenters(costCenters);

    for (const costCenter of costCenters) {
      const costCenterId = this.extractId(costCenter);
      const existing = costCenterId ? existingRecords.get(costCenterId) : undefined;
      const clientId = this.resolveClientId(costCenter, existing?.client_ID);

      if (!clientId) {
        throw createServiceError(400, 'Cost center must reference a client.');
      }

      const responsibleId = this.resolveRelationId(costCenter, 'responsible', existing?.responsible_ID);
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

  private resolveClientId(data: any, fallback?: string | null): string | null {
    const explicit = this.extractAssociationId(data, 'client');
    if (explicit !== undefined) {
      return explicit;
    }
    return fallback ?? null;
  }

  private resolveRelationId(data: any, relation: string, fallback?: string | null): string | null {
    const explicit = this.extractAssociationId(data, relation);
    if (explicit !== undefined) {
      return explicit;
    }
    return fallback ?? null;
  }

  private extractAssociationId(data: any, relation: string): string | null | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const foreignKey = `${relation}_ID`;
    if (Object.prototype.hasOwnProperty.call(data, foreignKey)) {
      const value = data[foreignKey];
      if (value === null || value === undefined) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      return null;
    }

    const association = data[relation];
    if (association === null) {
      return null;
    }
    if (association && typeof association === 'object') {
      const value = association.ID ?? association.id ?? association.Id;
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (value === null) {
        return null;
      }
    }

    return undefined;
  }

  private extractId(data: any): string | undefined {
    const id = data?.ID ?? data?.id ?? data?.Id;
    return typeof id === 'string' && id.trim() ? id.trim() : undefined;
  }

  private async loadExistingEmployees(employees: any[]): Promise<Map<string, EmployeeRow>> {
    const ids = employees
      .map((employee) => this.extractId(employee))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run(
      SELECT.from(EMPLOYEES_ENTITY)
        .columns('ID', 'client_ID', 'manager_ID', 'costCenter_ID')
        .where({ ID: { in: ids } }),
    )) as EmployeeRow[];

    const map = new Map<string, EmployeeRow>();
    for (const row of rows) {
      map.set(row.ID, row);
      this.cache.clientIds.set(`${EMPLOYEES_ENTITY}:${row.ID}`, row.client_ID ?? null);
    }
    return map;
  }

  private async loadExistingCostCenters(costCenters: any[]): Promise<Map<string, CostCenterRow>> {
    const ids = costCenters
      .map((costCenter) => this.extractId(costCenter))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run(
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
