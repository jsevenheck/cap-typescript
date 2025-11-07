jest.mock('../../../infrastructure/outbox/config', () => ({
  resolveOutboxDispatchInterval: jest.fn(() => 10),
  resolveCleanupInterval: jest.fn(() => 15),
}));

jest.mock('../../../infrastructure/outbox/dispatcher', () => ({
  processOutbox: jest.fn(),
}));

jest.mock('../../../infrastructure/outbox/cleanup', () => ({
  cleanupOutbox: jest.fn(),
}));

jest.mock('../../../shared/utils/logger', () => ({
  getLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

import { resolveOutboxDispatchInterval, resolveCleanupInterval } from '../../../infrastructure/outbox/config';
import { processOutbox } from '../../../infrastructure/outbox/dispatcher';
import { cleanupOutbox } from '../../../infrastructure/outbox/cleanup';
import {
  scheduledDispatch,
  purgeCompleted,
  shutdownDispatcher,
  startNotificationOutboxScheduler,
  getSchedulerState,
  resetNotificationDispatcher,
} from '../../../domain/employee/services/notification-outbox.service';

const mockResolveDispatch = resolveOutboxDispatchInterval as jest.MockedFunction<typeof resolveOutboxDispatchInterval>;
const mockResolveCleanup = resolveCleanupInterval as jest.MockedFunction<typeof resolveCleanupInterval>;
const mockProcessOutbox = processOutbox as jest.MockedFunction<typeof processOutbox>;
const mockCleanupOutbox = cleanupOutbox as jest.MockedFunction<typeof cleanupOutbox>;

describe('notification-outbox.service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockResolveDispatch.mockReturnValue(10);
    mockResolveCleanup.mockReturnValue(15);
    mockProcessOutbox.mockResolvedValue();
    mockCleanupOutbox.mockResolvedValue();
    resetNotificationDispatcher();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await shutdownDispatcher();
    resetNotificationDispatcher();
  });

  it('runs outbox dispatch once when invoked concurrently', async () => {
    let callCount = 0;
    mockProcessOutbox.mockImplementation(async () => {
      callCount += 1;
    });

    await Promise.all([scheduledDispatch(), scheduledDispatch()]);

    expect(callCount).toBe(1);
  });

  it('runs outbox cleanup once for concurrent requests', async () => {
    let callCount = 0;
    mockCleanupOutbox.mockImplementation(async () => {
      callCount += 1;
    });

    await Promise.all([purgeCompleted(), purgeCompleted()]);

    expect(callCount).toBe(1);
  });

  it('awaits in-flight work during shutdown', async () => {
    let resolveDispatch: (() => void) | undefined;
    mockProcessOutbox.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDispatch = resolve;
        }),
    );

    const dispatchPromise = scheduledDispatch();
    const shutdownPromise = shutdownDispatcher();

    expect(mockProcessOutbox).toHaveBeenCalledTimes(1);
    resolveDispatch?.();

    await expect(dispatchPromise).resolves.toBeUndefined();
    await expect(shutdownPromise).resolves.toBeUndefined();
  });

  it('schedules recurring jobs when started', async () => {
    jest.useFakeTimers();
    startNotificationOutboxScheduler();

    const state = getSchedulerState();
    expect(state.dispatchTimer).toBeDefined();
    expect(state.cleanupTimer).toBeDefined();

    jest.advanceTimersByTime(10);
    await Promise.resolve();
    expect(mockProcessOutbox).toHaveBeenCalled();

    jest.advanceTimersByTime(15);
    await Promise.resolve();
    expect(mockCleanupOutbox).toHaveBeenCalled();
  });
});
