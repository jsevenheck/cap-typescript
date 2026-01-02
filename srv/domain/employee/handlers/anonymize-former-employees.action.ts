import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { anonymizeFormerEmployees } from '../services/retention.service';
import { buildUserContext } from '../../../shared/utils/auth';
import { requireRequestUser } from '../../shared/request-context';

export const onAnonymizeFormerEmployees = async (req: Request): Promise<unknown> => {
  const user = buildUserContext(requireRequestUser(req));
  const tx = cds.tx(req);
  const count = await anonymizeFormerEmployees(tx, user, (req.data as { before?: unknown })?.before);
  return { value: count };
};

export default onAnonymizeFormerEmployees;
