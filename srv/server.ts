import cds from '@sap/cds';
import type { Application } from 'express';

cds.on('bootstrap', (app: Application) => {
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
});

export default cds.server;
