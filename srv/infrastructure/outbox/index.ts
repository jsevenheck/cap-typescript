import { loadOutboxConfig } from './config';
import { OutboxMetrics } from './metrics';
import { ParallelDispatcher } from './dispatcher';
import { OutboxCleanup } from './cleanup';
import { OutboxScheduler } from './scheduler';

const config = loadOutboxConfig();
const metrics = new OutboxMetrics();
const dispatcher = new ParallelDispatcher(config, metrics);
const cleanup = new OutboxCleanup(config);
const scheduler = new OutboxScheduler(dispatcher, cleanup, config);

export const outboxConfig = config;
export const outboxMetrics = metrics;
export const outboxDispatcher = dispatcher;
export const outboxCleanup = cleanup;
export const outboxScheduler = scheduler;
