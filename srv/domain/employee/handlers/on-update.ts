import type { Request } from '@sap/cds';

import { handleEmployeeUpsert } from './on-create';

export const onUpdate = (req: Request): Promise<void> => handleEmployeeUpsert(req);
export default onUpdate;
