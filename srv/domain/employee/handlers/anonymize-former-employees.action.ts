import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { anonymizeFormerEmployees } from '../services/retention.service';
import { buildUserContext } from '../../../shared/utils/auth';

export const onAnonymizeFormerEmployees = async (req: Request): Promise<unknown> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const tx = cds.transaction(req);
  const count = await anonymizeFormerEmployees(tx, user, (req.data as { before?: unknown })?.before);
  const result = { value: count };
  const requestWithReply = req as Request & {
    reply?: (data: unknown) => unknown;
    http?: { res?: { json?: (body: unknown) => void } };
  };
  if (requestWithReply.http?.res && typeof requestWithReply.http.res.json === 'function') {
    requestWithReply.http.res.json(result);
    return undefined;
  }
  if (typeof requestWithReply.reply === 'function') {
    requestWithReply.reply(result);
    return undefined;
  }
  return result;
};

export default onAnonymizeFormerEmployees;
