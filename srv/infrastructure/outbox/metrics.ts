/**
 * Prometheus metrics for outbox monitoring
 */
import * as prom from 'prom-client';

/**
 * Outbox metrics collector
 */
export class OutboxMetrics {
  private readonly enqueuedCounter: prom.Counter;
  private readonly dispatchedCounter: prom.Counter;
  private readonly failedCounter: prom.Counter;
  private readonly dlqCounter: prom.Counter;
  private readonly pendingGauge: prom.Gauge;
  private readonly processingDuration: prom.Histogram;

  constructor(register?: prom.Registry) {
    const reg = register ?? prom.register;

    this.enqueuedCounter = new prom.Counter({
      name: 'outbox_messages_enqueued_total',
      help: 'Total number of messages enqueued to outbox',
      labelNames: ['event_type'],
      registers: [reg],
    });

    this.dispatchedCounter = new prom.Counter({
      name: 'outbox_messages_dispatched_total',
      help: 'Total number of messages successfully dispatched',
      labelNames: ['destination'],
      registers: [reg],
    });

    this.failedCounter = new prom.Counter({
      name: 'outbox_messages_failed_total',
      help: 'Total number of messages that failed delivery',
      labelNames: ['destination', 'reason'],
      registers: [reg],
    });

    this.dlqCounter = new prom.Counter({
      name: 'outbox_messages_dlq_total',
      help: 'Total number of messages moved to Dead Letter Queue',
      labelNames: ['destination'],
      registers: [reg],
    });

    this.pendingGauge = new prom.Gauge({
      name: 'outbox_messages_pending',
      help: 'Current number of pending messages in outbox',
      registers: [reg],
    });

    this.processingDuration = new prom.Histogram({
      name: 'outbox_processing_duration_seconds',
      help: 'Duration of outbox message processing',
      labelNames: ['destination', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [reg],
    });
  }

  /**
   * Record a message enqueued to outbox
   */
  recordEnqueued(eventType: string, count: number = 1): void {
    this.enqueuedCounter.inc({ event_type: eventType }, count);
  }

  /**
   * Record a successful message dispatch
   */
  recordDispatched(destination: string): void {
    this.dispatchedCounter.inc({ destination });
  }

  /**
   * Record a failed message delivery
   */
  recordFailed(destination: string, reason: string = 'unknown'): void {
    this.failedCounter.inc({ destination, reason });
  }

  /**
   * Record a message moved to DLQ
   */
  recordDLQ(destination: string): void {
    this.dlqCounter.inc({ destination });
  }

  /**
   * Update pending message count
   */
  updatePending(count: number): void {
    this.pendingGauge.set(count);
  }

  /**
   * Record processing duration
   */
  recordProcessingDuration(destination: string, status: 'success' | 'failure', durationSeconds: number): void {
    this.processingDuration.observe({ destination, status }, durationSeconds);
  }

  /**
   * Start a timer for processing duration
   */
  startTimer(destination: string): () => void {
    const start = Date.now();
    return () => {
      const duration = (Date.now() - start) / 1000;
      this.recordProcessingDuration(destination, 'success', duration);
    };
  }
}

// Singleton instance
let metricsInstance: OutboxMetrics | null = null;

/**
 * Get or create the singleton metrics instance
 */
export const getOutboxMetrics = (): OutboxMetrics => {
  if (!metricsInstance) {
    metricsInstance = new OutboxMetrics();
  }
  return metricsInstance;
};

/**
 * Reset metrics instance (useful for testing)
 */
export const resetOutboxMetrics = (): void => {
  metricsInstance = null;
};
