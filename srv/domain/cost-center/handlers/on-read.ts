import type { Request } from '@sap/cds';

export const onRead = async (req: Request, next: () => Promise<unknown>): Promise<unknown> => next();

export default onRead;
