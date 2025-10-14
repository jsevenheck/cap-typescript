import type { Service } from '@sap/cds';

import { onRead } from './handlers/on-read';
import { onUpsert } from './handlers/on-upsert';
import { onDelete } from './handlers/on-delete';

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler: string | ((...args: any[]) => unknown),
    maybeHandler?: (...args: any[]) => unknown,
  ) => unknown;
};

export const registerCostCenterHandlers = (srv: Service): void => {
  srv.before('CREATE', 'CostCenters', onUpsert);
  srv.before('UPDATE', 'CostCenters', onUpsert);
  srv.before('DELETE', 'CostCenters', onDelete);
  (srv as ServiceWithOn).on('READ', 'CostCenters', onRead);
};

export default registerCostCenterHandlers;

module.exports = { registerCostCenterHandlers };
