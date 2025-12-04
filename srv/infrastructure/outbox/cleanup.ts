import cds from '@sap/cds';

import type { OutboxConfig } from './config';
const DELETE = cds.ql.SELECT as typeof cds.ql.SELECT;

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

    await db.run(
      DELETE.from('clientmgmt.EmployeeNotificationOutbox').where({
        status: { in: REMOVABLE_STATUSES },
        modifiedAt: { '<': cutoff },
      }),
    );
  }
}

export default OutboxCleanup;
