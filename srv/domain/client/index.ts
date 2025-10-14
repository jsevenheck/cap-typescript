import type { Service } from '@sap/cds';

import { onCreate } from './handlers/on-create';
import { onUpdate } from './handlers/on-update';
import { onDelete } from './handlers/on-delete';

export const registerClientHandlers = (srv: Service): void => {
  srv.before('CREATE', 'Clients', onCreate);
  srv.before('UPDATE', 'Clients', onUpdate);
  srv.before('DELETE', 'Clients', onDelete);
};

export default registerClientHandlers;

module.exports = { registerClientHandlers };
