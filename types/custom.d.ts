import '@sap/cds/apis/cds';
import type { CapUserLike } from '../srv/shared/utils/auth';

declare module '@sap/cds' {
  interface Request {
    user?: CapUserLike;
  }
}
