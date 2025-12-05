import path from 'node:path';
import cds from '@sap/cds';

describe('CAP service exposure', () => {
  let csn: any;

  beforeAll(async () => {
    csn = await cds.load(path.join(__dirname, '..', 'service.cds'));
  });

  it('exposes only ClientService at the configured relative path', () => {
    const services = Object.entries(csn.definitions).filter(([, definition]: any) => definition.kind === 'service');

    expect(services.map(([name]) => name)).toEqual(['ClientService']);
    const [, clientService] = services[0];
    expect(clientService['@path']).toBe('/clients');
  });
});
