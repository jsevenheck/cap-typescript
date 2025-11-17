import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { handleResponsibilityChange } from '../services/manager-responsibility.service';

export const afterUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    return;
  }

  const tx = cds.transaction(req);
  const data = req.data as {
    employee_ID: string;
    costCenter_ID: string;
    validFrom: string;
    validTo?: string | null;
    isResponsible: boolean;
  };

  // Handle manager responsibility if this is a responsible assignment
  if (data.isResponsible) {
    await handleResponsibilityChange(tx, {
      employee_ID: data.employee_ID,
      costCenter_ID: data.costCenter_ID,
      validFrom: data.validFrom,
      validTo: data.validTo,
      isResponsible: data.isResponsible,
    });
  }
};

export default afterUpsert;
