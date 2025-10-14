import cds from '@sap/cds';

import { resolveOutboxRetentionHours } from './config';

const ql = cds.ql as typeof cds.ql & { DELETE: typeof cds.ql.SELECT };

const STATUSES_FOR_CLEANUP = ['COMPLETED', 'DELIVERED', 'FAILED'];

export const cleanupOutbox = async (): Promise<void> => {
  const db = (cds as any).db ?? (await cds.connect.to('db'));
  if (!db) {
    return;
  }

  const retentionHours = resolveOutboxRetentionHours();
  if (retentionHours <= 0) {
    return;
  }

  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

  await db.run(
    (ql.DELETE as any).from('clientmgmt.EmployeeNotificationOutbox').where({
      status: { in: STATUSES_FOR_CLEANUP },
      modifiedAt: { '<': cutoff },
    }),
  );
};

export default cleanupOutbox;
