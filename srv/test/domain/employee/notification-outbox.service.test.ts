import {
  scheduledDispatch,
  purgeCompleted,
  shutdownDispatcher,
} from '../../../domain/employee/services/notification-outbox.service';

// Mock infrastructure modules
jest.mock('../../../infrastructure/outbox/dispatcher', () => ({
  processOutbox: jest.fn(),
}));

jest.mock('../../../infrastructure/outbox/cleanup', () => ({
  cleanupOutbox: jest.fn(),
}));

import { processOutbox } from '../../../infrastructure/outbox/dispatcher';
import { cleanupOutbox } from '../../../infrastructure/outbox/cleanup';

describe('Notification Outbox Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scheduledDispatch', () => {
    it('should call processOutbox from infrastructure', async () => {
      (processOutbox as jest.Mock).mockResolvedValue(undefined);

      await scheduledDispatch();

      expect(processOutbox).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from processOutbox', async () => {
      const error = new Error('Dispatch failed');
      (processOutbox as jest.Mock).mockRejectedValue(error);

      await expect(scheduledDispatch()).rejects.toThrow('Dispatch failed');
    });
  });

  describe('purgeCompleted', () => {
    it('should call cleanupOutbox from infrastructure', async () => {
      (cleanupOutbox as jest.Mock).mockResolvedValue(undefined);

      await purgeCompleted();

      expect(cleanupOutbox).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from cleanupOutbox', async () => {
      const error = new Error('Cleanup failed');
      (cleanupOutbox as jest.Mock).mockRejectedValue(error);

      await expect(purgeCompleted()).rejects.toThrow('Cleanup failed');
    });
  });

  describe('shutdownDispatcher', () => {
    it('should resolve without errors', async () => {
      await expect(shutdownDispatcher()).resolves.not.toThrow();
    });

    it('should return void promise', async () => {
      const result = await shutdownDispatcher();
      expect(result).toBeUndefined();
    });
  });
});
