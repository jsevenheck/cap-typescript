import cds from '@sap/cds';
import type { Request, Service } from '@sap/cds';
import type {
  ClientEntity,
  CostCenterEntity,
  EmployeeEntity,
  EmployeeIdCounterEntity,
} from '../types/models';

type ClientService = Service;

interface ExtendedRequest<T> extends Request {
  data: Partial<T>;
  params?: Array<Record<string, unknown>>;
}

type EmployeeRequest = ExtendedRequest<EmployeeEntity>;
type ClientRequest = ExtendedRequest<ClientEntity>;
type CostCenterRequest = ExtendedRequest<CostCenterEntity>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: string;
    }
  }
}

const { SELECT, INSERT, UPDATE } = cds.ql;

const normalizeCompanyId = (value?: string): string | undefined =>
  value?.trim().toUpperCase();

const normalizeCostCenterCode = (value?: string): string | undefined =>
  value?.trim().toUpperCase();

const ensureClientExists = async (req: EmployeeRequest, clientId?: string): Promise<boolean> => {
  if (!clientId) {
    req.error(400, 'Client reference is required.');
    return false;
  }

  const tx = cds.transaction(req);
  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('ID').where({ ID: clientId }),
  )) as ClientEntity | undefined;
  if (!client) {
    req.error(404, `Client ${clientId} not found.`);
    return false;
  }
  return true;
};

const ensureEmployeeAssignment = async (req: EmployeeRequest): Promise<void> => {
  const tx = cds.transaction(req);
  let { client_ID: clientId } = req.data;

  if (!clientId && req.event === 'UPDATE') {
    const employeeKey =
      req.data.ID ?? (Array.isArray(req.params) && req.params.length > 0 ? req.params[0]?.ID : undefined);
    if (!employeeKey) {
      req.error(400, 'Employee identifier is required.');
      return;
    }

    const existingEmployee = (await tx.run(
      SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: employeeKey }),
    )) as EmployeeEntity | undefined;

    if (!existingEmployee) {
      req.error(404, `Employee ${employeeKey} not found.`);
      return;
    }

    clientId = existingEmployee.client_ID;
    req.data.client_ID = clientId;
  }

  const exists = await ensureClientExists(req, clientId);
  if (!exists) {
    return;
  }

  const trim = (val?: string) => val?.trim();
  if (req.data.firstName) req.data.firstName = req.data.firstName.trim();
  if (req.data.lastName) req.data.lastName = req.data.lastName.trim();
  if (req.data.email) req.data.email = req.data.email.trim().toLowerCase();
  if (req.data.location) req.data.location = trim(req.data.location);
  if (req.data.positionLevel) req.data.positionLevel = trim(req.data.positionLevel);

  if (req.data.manager_ID) {
    const manager = (await tx.run(
      SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: req.data.manager_ID }),
    )) as EmployeeEntity | undefined;
    if (!manager) {
      req.error(404, `Manager ${req.data.manager_ID} not found.`);
      return;
    }
    if (manager.client_ID !== clientId) {
      req.error(400, 'Manager must belong to the same client.');
      return;
    }
  }

  if (req.data.costCenter_ID) {
    const costCenter = (await tx.run(
      SELECT.one.from('clientmgmt.CostCenters')
        .columns('client_ID')
        .where({ ID: req.data.costCenter_ID }),
    )) as CostCenterEntity | undefined;
    if (!costCenter) {
      req.error(404, `Cost center ${req.data.costCenter_ID} not found.`);
      return;
    }
    if (costCenter.client_ID !== clientId) {
      req.error(400, 'Cost center must belong to the same client.');
      return;
    }
  }
};

const ensureUniqueEmployeeId = async (req: EmployeeRequest): Promise<void> => {
  const tx = cds.transaction(req);
  const { client_ID: clientId } = req.data;
  if (!clientId) {
    return;
  }

  if (req.data.employeeId) {
    req.data.employeeId = req.data.employeeId.trim().toUpperCase();
    const existing = (await tx.run(
      SELECT.one.from('clientmgmt.Employees')
        .columns('ID')
        .where({ employeeId: req.data.employeeId }),
    )) as EmployeeEntity | undefined;
    if (existing && existing.ID !== req.data.ID) {
      req.error(409, `Employee ID ${req.data.employeeId} already exists.`);
    }
    return;
  }

  const counter = (await tx.run(
    SELECT.one.from('clientmgmt.EmployeeIdCounters').where({ client_ID: clientId }),
  )) as EmployeeIdCounterEntity | undefined;

  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('companyId').where({ ID: clientId }),
  )) as ClientEntity | undefined;

  const prefix = normalizeCompanyId(client?.companyId) ?? 'EMP';
  const nextCounter = (counter?.lastCounter ?? 0) + 1;
  req.data.employeeId = `${prefix}-${String(nextCounter).padStart(4, '0')}`;

  if (counter) {
    await tx.run(
      UPDATE('clientmgmt.EmployeeIdCounters')
        .set({ lastCounter: nextCounter })
        .where({ client_ID: clientId }),
    );
  } else {
    await tx.run(
      INSERT.into('clientmgmt.EmployeeIdCounters').entries({
        client_ID: clientId,
        lastCounter: nextCounter,
      }),
    );
  }
};

const registerClientHandlers = (service: ClientService): void => {
  service.before(['CREATE', 'UPDATE'], 'Clients', async (req: ClientRequest) => {
    if (req.data.companyId) {
      req.data.companyId = normalizeCompanyId(req.data.companyId);
    }

    if (req.event === 'CREATE' && req.data.companyId) {
      const tx = cds.transaction(req);
      const existing = (await tx.run(
        SELECT.one
          .from('clientmgmt.Clients')
          .columns('ID')
          .where({ companyId: req.data.companyId }),
      )) as ClientEntity | undefined;
      if (existing) {
        req.error(409, `Company ID ${req.data.companyId} already exists.`);
      }
    }
  });
};

const registerEmployeeHandlers = (service: ClientService): void => {
  service.before('CREATE', 'Employees', async (req: EmployeeRequest) => {
    await ensureEmployeeAssignment(req);
    await ensureUniqueEmployeeId(req);
  });

  service.before('UPDATE', 'Employees', async (req: EmployeeRequest) => {
    await ensureEmployeeAssignment(req);
    if (req.data.employeeId) {
      await ensureUniqueEmployeeId(req);
    }
  });
};

const registerCostCenterHandlers = (service: ClientService): void => {
  service.before(['CREATE', 'UPDATE'], 'CostCenters', async (req: CostCenterRequest) => {
    if (req.data.code) {
      req.data.code = normalizeCostCenterCode(req.data.code);
    }

    const tx = cds.transaction(req);
    const { client_ID: clientId, responsible_ID: responsibleId } = req.data;
    if (!clientId) {
      req.error(400, 'Client reference is required.');
      return;
    }

    const responsible = responsibleId
      ? ((await tx.run(
          SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: responsibleId }),
        )) as EmployeeEntity | undefined)
      : undefined;

    if (responsibleId && !responsible) {
      req.error(404, `Responsible employee ${responsibleId} not found.`);
      return;
    }
    if (responsible && responsible.client_ID !== clientId) {
      req.error(400, 'Responsible employee must belong to the same client.');
      return;
    }
  });
};

export default cds.service.impl((service: ClientService) => {
  registerClientHandlers(service);
  registerEmployeeHandlers(service);
  registerCostCenterHandlers(service);
});
