import type { Request } from '@sap/cds';

export const onRead = async (_: Request): Promise<void> => {
  // No custom logic needed for READ; framework handles it
};

export default onRead;
