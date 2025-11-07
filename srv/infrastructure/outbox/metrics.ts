import * as prom from 'prom-client';

export class OutboxMetrics {
  private readonly enqueuedCounter: prom.Counter;
  private readonly dispatchedCounter: prom.Counter;
  private readonly failedCounter: prom.Counter;
  private readonly pendingGauge: prom.Gauge;

  constructor(private readonly registry: prom.Registry = prom.register) {
    this.enqueuedCounter = new prom.Counter({
      name: 'outbox_entries_enqueued_total',
      help: 'Total number of entries enqueued in the outbox',
      registers: [this.registry],
    });

    this.dispatchedCounter = new prom.Counter({
      name: 'outbox_entries_dispatched_total',
      help: 'Total number of outbox entries dispatched successfully',
      registers: [this.registry],
    });

    this.failedCounter = new prom.Counter({
      name: 'outbox_entries_failed_total',
      help: 'Total number of outbox entries that failed dispatch',
      registers: [this.registry],
    });

    this.pendingGauge = new prom.Gauge({
      name: 'outbox_entries_pending',
      help: 'Current number of pending outbox entries awaiting dispatch',
      registers: [this.registry],
    });
  }

  recordEnqueued(count: number): void {
    if (count > 0) {
      this.enqueuedCounter.inc(count);
    }
  }

  recordDispatched(): void {
    this.dispatchedCounter.inc();
  }

  recordFailed(): void {
    this.failedCounter.inc();
  }

  updatePending(count: number): void {
    if (count >= 0) {
      this.pendingGauge.set(count);
    }
  }
}

export default OutboxMetrics;
