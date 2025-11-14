import * as prom from 'prom-client';

export class OutboxMetrics {
  private readonly enqueuedCounter: prom.Counter;
  private readonly dispatchedCounter: prom.Counter;
  private readonly failedCounter: prom.Counter;
  private readonly enqueueRetryCounter: prom.Counter;
  private readonly enqueueRetrySuccessCounter: prom.Counter;
  private readonly enqueueFailureCounter: prom.Counter;
  private readonly claimConflictCounter: prom.Counter;
  private readonly pendingGauge: prom.Gauge;
  private readonly dispatchDurationHistogram: prom.Histogram;

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

    this.enqueueRetryCounter = new prom.Counter({
      name: 'outbox_enqueue_retry_total',
      help: 'Total number of enqueue retry attempts',
      registers: [this.registry],
    });

    this.enqueueRetrySuccessCounter = new prom.Counter({
      name: 'outbox_enqueue_retry_success_total',
      help: 'Total number of successful enqueues after retry',
      registers: [this.registry],
    });

    this.enqueueFailureCounter = new prom.Counter({
      name: 'outbox_enqueue_failure_total',
      help: 'Total number of permanent enqueue failures',
      registers: [this.registry],
    });

    this.claimConflictCounter = new prom.Counter({
      name: 'outbox_claim_conflict_total',
      help: 'Total number of claim conflicts during dispatch',
      registers: [this.registry],
    });

    this.pendingGauge = new prom.Gauge({
      name: 'outbox_entries_pending',
      help: 'Current number of pending outbox entries awaiting dispatch',
      registers: [this.registry],
    });

    this.dispatchDurationHistogram = new prom.Histogram({
      name: 'outbox_dispatch_duration_ms',
      help: 'Histogram of outbox entry dispatch duration in milliseconds',
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
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

  recordEnqueueRetry(): void {
    this.enqueueRetryCounter.inc();
  }

  recordEnqueueRetrySuccess(): void {
    this.enqueueRetrySuccessCounter.inc();
  }

  recordEnqueueFailure(): void {
    this.enqueueFailureCounter.inc();
  }

  recordClaimConflict(): void {
    this.claimConflictCounter.inc();
  }

  updatePending(count: number): void {
    if (count >= 0) {
      this.pendingGauge.set(count);
    }
  }

  recordDispatchDuration(durationMs: number): void {
    if (durationMs >= 0) {
      this.dispatchDurationHistogram.observe(durationMs);
    }
  }
}

export default OutboxMetrics;
