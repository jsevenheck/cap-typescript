import cron, { type ScheduledTask } from 'node-cron';

import type { OutboxConfig } from './config';
import { ParallelDispatcher } from './dispatcher';
import { OutboxCleanup } from './cleanup';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('outbox-scheduler');

export class OutboxScheduler {
  private dispatchTimer?: NodeJS.Timeout;
  private cleanupTask?: ScheduledTask;
  private started = false;

  constructor(
    private readonly dispatcher: ParallelDispatcher,
    private readonly cleanup: OutboxCleanup,
    private readonly config: OutboxConfig,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.dispatchTimer = setInterval(() => {
      void this.dispatcher
        .dispatchPending()
        .catch((error) => logger.error({ err: error }, 'Failed to dispatch outbox batch'));
    }, this.config.dispatchInterval);

    this.cleanupTask = cron.schedule(this.config.cleanupCron, () => {
      void this.cleanup
        .run()
        .catch((error) => logger.error({ err: error }, 'Failed to execute outbox cleanup'));
    });
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    if (this.dispatchTimer) {
      clearInterval(this.dispatchTimer);
      this.dispatchTimer = undefined;
    }

    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = undefined;
    }

    this.started = false;
  }
}

export default OutboxScheduler;
