import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { buildUserContext, collectAttributeValues, userHasRole } from '../shared/utils/auth';
import { normalizeCompanyId } from '../shared/utils/normalization';
import { createServiceError } from '../shared/utils/errors';
import {
  extractEntityId,
  resolveAssociationId,
} from '../shared/utils/associations';

type ClientRow = {
  ID: string;
  companyId: string;
};

type EmployeeRow = {
  ID: string;
  client_ID: string;
};

type CostCenterRow = {
  ID: string;
  client_ID: string;
};

type LocationRow = {
  ID: string;
  client_ID: string;
};

const CLIENTS_ENTITY = 'clientmgmt.Clients';
const EMPLOYEES_ENTITY = 'clientmgmt.Employees';
const COST_CENTERS_ENTITY = 'clientmgmt.CostCenters';
const LOCATIONS_ENTITY = 'clientmgmt.Locations';
const { SELECT } = cds.ql;

const collectPayloads = (req: Request): any[] => {
  const data = (req.data ?? (req as any).query?.UPDATE?.data) ?? [];
  if (Array.isArray(data)) {
    return data;
  }
  return data ? [data] : [];
};

export class CompanyAuthorization {
  private readonly runner: { run: (query: any) => Promise<any> };
  private readonly user: ReturnType<typeof buildUserContext>;
  private readonly allowedCompanies: Set<string>;
  private readonly clientCompanyCache = new Map<string, string | null>();

  constructor(private readonly req: Request) {
    const transaction = cds.transaction(req);
    if (transaction && typeof (transaction as { run?: unknown }).run === 'function') {
      this.runner = transaction as { run: (query: any) => Promise<any> };
    } else if (typeof (req as unknown as { run?: unknown }).run === 'function') {
      this.runner = req as unknown as { run: (query: any) => Promise<any> };
    } else {
      throw createServiceError(500, 'Unable to obtain database runner for authorization checks.');
    }
    this.user = buildUserContext((req as any).user);
    this.allowedCompanies = this.resolveAllowedCompanies();
  }

  shouldSkip(): boolean {
    return userHasRole(this.user, 'HRAdmin');
  }

  async validateClientAccess(clients: any[]): Promise<void> {
    if (!clients.length || this.shouldSkip()) {
      return;
    }

    const existingClients = await this.loadExistingClients(clients);

    for (const client of clients) {
      const clientId = extractEntityId(client);
      const existing = clientId ? existingClients.get(clientId) : undefined;

      if (existing) {
        this.ensureClientAccess(existing.ID, `client ${existing.ID}`);
      }

      const candidate = typeof client.companyId === 'string' ? client.companyId : existing?.companyId;
      const normalized = normalizeCompanyId(candidate ?? undefined);

      if (!normalized) {
        throw createServiceError(400, 'Client must provide a companyId.');
      }

      this.ensureCompanyAllowed(normalized, `client ${clientId ?? '(new)'}`);
    }
  }

  async validateEmployeeAccess(employees: any[]): Promise<void> {
    if (!employees.length || this.shouldSkip()) {
      return;
    }

    const existingEmployees = await this.loadExistingEmployees(employees);
    const targetClientIds = new Set<string>();

    for (const employee of employees) {
      const employeeId = extractEntityId(employee);
      const existing = employeeId ? existingEmployees.get(employeeId) : undefined;
      const clientId = resolveAssociationId(employee, 'client', existing?.client_ID);

      if (existing?.client_ID) {
        targetClientIds.add(existing.client_ID);
      }
      if (clientId) {
        targetClientIds.add(clientId);
      }
    }

    await this.ensureClientsLoaded(targetClientIds);

    for (const employee of employees) {
      const employeeId = extractEntityId(employee);
      const existing = employeeId ? existingEmployees.get(employeeId) : undefined;
      if (existing?.client_ID) {
        this.ensureClientAccess(existing.client_ID, `employee ${employeeId ?? '(new)'}`);
      }
      const clientId = resolveAssociationId(employee, 'client', existing?.client_ID);

      if (!clientId) {
        throw createServiceError(400, 'Employee must reference a client.');
      }

      this.ensureClientAccess(clientId, `employee ${employeeId ?? '(new)'}`);
    }
  }

  async validateCostCenterAccess(costCenters: any[]): Promise<void> {
    if (!costCenters.length || this.shouldSkip()) {
      return;
    }

    const existingCostCenters = await this.loadExistingCostCenters(costCenters);
    const targetClientIds = new Set<string>();

    for (const costCenter of costCenters) {
      const costCenterId = extractEntityId(costCenter);
      const existing = costCenterId ? existingCostCenters.get(costCenterId) : undefined;
      const clientId = resolveAssociationId(costCenter, 'client', existing?.client_ID);

      if (existing?.client_ID) {
        targetClientIds.add(existing.client_ID);
      }
      if (clientId) {
        targetClientIds.add(clientId);
      }
    }

    await this.ensureClientsLoaded(targetClientIds);

    for (const costCenter of costCenters) {
      const costCenterId = extractEntityId(costCenter);
      const existing = costCenterId ? existingCostCenters.get(costCenterId) : undefined;
      if (existing?.client_ID) {
        this.ensureClientAccess(existing.client_ID, `cost center ${costCenterId ?? '(new)'}`);
      }
      const clientId = resolveAssociationId(costCenter, 'client', existing?.client_ID);

      if (!clientId) {
        throw createServiceError(400, 'Cost center must reference a client.');
      }

      this.ensureClientAccess(clientId, `cost center ${costCenterId ?? '(new)'}`);
    }
  }

  async validateLocationAccess(locations: any[]): Promise<void> {
    if (!locations.length || this.shouldSkip()) {
      return;
    }

    const existingLocations = await this.loadExistingLocations(locations);
    const targetClientIds = new Set<string>();

    for (const location of locations) {
      const locationId = extractEntityId(location);
      const existing = locationId ? existingLocations.get(locationId) : undefined;
      const clientId = resolveAssociationId(location, 'client', existing?.client_ID);

      if (existing?.client_ID) {
        targetClientIds.add(existing.client_ID);
      }
      if (clientId) {
        targetClientIds.add(clientId);
      }
    }

    await this.ensureClientsLoaded(targetClientIds);

    for (const location of locations) {
      const locationId = extractEntityId(location);
      const existing = locationId ? existingLocations.get(locationId) : undefined;
      if (existing?.client_ID) {
        this.ensureClientAccess(existing.client_ID, `location ${locationId ?? '(new)'}`);
      }
      const clientId = resolveAssociationId(location, 'client', existing?.client_ID);

      if (!clientId) {
        throw createServiceError(400, 'Location must reference a client.');
      }

      this.ensureClientAccess(clientId, `location ${locationId ?? '(new)'}`);
    }
  }

  private resolveAllowedCompanies(): Set<string> {
    const allowed = new Set<string>();
    const attributeNames = ['CompanyCode', 'companyCodes'];
    const values = collectAttributeValues(this.user, attributeNames)
      .map((value) => normalizeCompanyId(value))
      .filter((value): value is string => Boolean(value));
    for (const value of values) {
      allowed.add(value);
    }
    return allowed;
  }

  private ensureCompanyAllowed(companyId: string, context: string): void {
    if (!this.allowedCompanies.size) {
      throw createServiceError(403, 'Forbidden: user has no assigned company codes.');
    }

    if (!this.allowedCompanies.has(companyId)) {
      throw createServiceError(403, `Forbidden: not authorized to modify ${context} for company ${companyId}.`);
    }
  }

  private ensureClientAccess(clientId: string, context: string): void {
    const companyId = this.clientCompanyCache.get(clientId);
    if (companyId == null) {
      throw createServiceError(404, `Client ${clientId} not found.`);
    }

    this.ensureCompanyAllowed(companyId, context);
  }

  private async loadExistingClients(clients: any[]): Promise<Map<string, ClientRow>> {
    const ids = clients
      .map((client) => extractEntityId(client))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run(
      SELECT.from(CLIENTS_ENTITY).columns('ID', 'companyId').where({ ID: { in: ids } }),
    )) as ClientRow[];

    const map = new Map<string, ClientRow>();
    for (const row of rows) {
      map.set(row.ID, row);
      const normalized = normalizeCompanyId(row.companyId ?? undefined);
      this.clientCompanyCache.set(row.ID, normalized ?? null);
    }
    return map;
  }

  private async loadExistingEmployees(employees: any[]): Promise<Map<string, EmployeeRow>> {
    const ids = employees
      .map((employee) => extractEntityId(employee))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run(
      SELECT.from(EMPLOYEES_ENTITY).columns('ID', 'client_ID').where({ ID: { in: ids } }),
    )) as EmployeeRow[];

    const map = new Map<string, EmployeeRow>();
    for (const row of rows) {
      map.set(row.ID, row);
    }
    return map;
  }

  private async loadExistingCostCenters(costCenters: any[]): Promise<Map<string, CostCenterRow>> {
    const ids = costCenters
      .map((costCenter) => extractEntityId(costCenter))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run(
      SELECT.from(COST_CENTERS_ENTITY).columns('ID', 'client_ID').where({ ID: { in: ids } }),
    )) as CostCenterRow[];

    const map = new Map<string, CostCenterRow>();
    for (const row of rows) {
      map.set(row.ID, row);
    }
    return map;
  }

  private async loadExistingLocations(locations: any[]): Promise<Map<string, LocationRow>> {
    const ids = locations
      .map((location) => extractEntityId(location))
      .filter((id): id is string => Boolean(id));

    if (!ids.length) {
      return new Map();
    }

    const rows = (await this.runner.run(
      SELECT.from(LOCATIONS_ENTITY).columns('ID', 'client_ID').where({ ID: { in: ids } }),
    )) as LocationRow[];

    const map = new Map<string, LocationRow>();
    for (const row of rows) {
      map.set(row.ID, row);
    }
    return map;
  }

  private async ensureClientsLoaded(clientIds: Set<string>): Promise<void> {
    const pending = Array.from(clientIds).filter((id) => !this.clientCompanyCache.has(id));
    if (!pending.length) {
      return;
    }

    const rows = (await this.runner.run(
      SELECT.from(CLIENTS_ENTITY).columns('ID', 'companyId').where({ ID: { in: pending } }),
    )) as ClientRow[];

    for (const row of rows) {
      const normalized = normalizeCompanyId(row.companyId ?? undefined);
      this.clientCompanyCache.set(row.ID, normalized ?? null);
    }

    for (const id of pending) {
      if (!this.clientCompanyCache.has(id)) {
        this.clientCompanyCache.set(id, null);
      }
    }
  }
}

export const authorizeClients = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  const authorization = new CompanyAuthorization(req);
  await authorization.validateClientAccess(entries);
};

export const authorizeEmployees = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  const authorization = new CompanyAuthorization(req);
  await authorization.validateEmployeeAccess(entries);
};

export const authorizeCostCenters = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  const authorization = new CompanyAuthorization(req);
  await authorization.validateCostCenterAccess(entries);
};

export const authorizeLocations = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  const authorization = new CompanyAuthorization(req);
  await authorization.validateLocationAccess(entries);
};

export default CompanyAuthorization;
