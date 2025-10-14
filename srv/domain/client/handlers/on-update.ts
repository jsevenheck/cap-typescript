import type { Request } from '@sap/cds';

import { handleClientCreateOrUpdate } from './on-create';

export const onUpdate = (req: Request): Promise<void> => handleClientCreateOrUpdate(req);
export default onUpdate;
