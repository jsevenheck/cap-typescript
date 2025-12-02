import cds from '@sap/cds';

import type { OutboxConfig } from './config';
import { resolveTenant } from '../../shared/utils/tenant';

const ql = cds.ql as typeof cds.ql & { DELETE: typeof cds.ql.SELECT };

const REMOVABLE_STATUSES = ['COMPLETED', 'DELIVERED', 'FAILED'];

export class OutboxCleanup {
  constructor(private readonly config: OutboxConfig) {}

  async run(): Promise<void> {
    const retention = this.config.cleanupRetention;
    if (retention <= 0) {
      return;
    }

    const db = (cds as any).db ?? (await cds.connect.to('db'));
    if (!db) {
      return;
    }

    const cutoff = new Date(Date.now() - retention);
    const tenant = resolveTenant();

    await db.run(
      (ql.DELETE as any).from('clientmgmt.EmployeeNotificationOutbox').where({
        status: { in: REMOVABLE_STATUSES },
        modifiedAt: { '<': cutoff },
        tenant,
      }),
    );
  }
}

export default OutboxCleanup;
