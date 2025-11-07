import type { Request, Service } from '@sap/cds';

import { onCreate } from './handlers/on-create';
import { onUpdate } from './handlers/on-update';
import { onDelete } from './handlers/on-delete';
import { onRead } from './handlers/on-read';

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler: string | ((...args: unknown[]) => unknown),
    maybeHandler?: (...args: unknown[]) => unknown,
  ) => unknown;
};

export const registerClientHandlers = (srv: Service): void => {
  srv.before('CREATE', 'Clients', onCreate);
  srv.before('UPDATE', 'Clients', onUpdate);
  srv.before('DELETE', 'Clients', onDelete);
  const serviceWithOn = srv as ServiceWithOn;
  const readHandler: (...args: unknown[]) => Promise<unknown> = (req, next) =>
    onRead(req as Request, (next as (() => Promise<unknown>) | undefined) ?? (async () => undefined));
  serviceWithOn.on('READ', 'Clients', readHandler);
};

export default registerClientHandlers;

module.exports = { registerClientHandlers };
