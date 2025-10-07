// srv/service.cds
using { clientmgmt as db } from '../db/schema';
using { sap.common.Countries as CommonCountries } from '@sap/cds/common';

service ClientService @(path:'/odata/v4/clients', impl:'./handlers/client-service.ts') {
  @odata.etag: 'modifiedAt'
  @restrict: [
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HRAdmin' },
    { grant: 'READ', to: 'HRViewer',  where: 'companyId in $user.companyCodes' },
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HREditor', where: 'companyId in $user.companyCodes' },

    { grant: 'READ', to: 'ClientViewer' },
    { grant: ['CREATE','UPDATE','DELETE'], to: 'ClientEditor' }
  ]
  entity Clients as projection on db.Clients {
    *,
    employees: redirected to Employees,
    costCenters: redirected to CostCenters
  };

  @odata.etag: 'modifiedAt'
  @restrict: [
    { grant: 'READ', to: 'HRAdmin' },
    { grant: 'READ', to: 'HRViewer',  where: 'client.companyId in $user.companyCodes' },
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HREditor', where: 'client.companyId in $user.companyCodes' },

    { grant: 'READ', to: 'ClientViewer' },
    { grant: ['CREATE','UPDATE','DELETE'], to: 'ClientEditor' }
  ]
  entity Employees as projection on db.Employees;

  @odata.etag: 'modifiedAt'
  @restrict: [
    { grant: 'READ', to: 'HRAdmin' },
    { grant: 'READ', to: 'HRViewer',  where: 'client.companyId in $user.companyCodes' },
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HREditor', where: 'client.companyId in $user.companyCodes' },

    { grant: 'READ', to: 'ClientViewer' },
    { grant: ['CREATE','UPDATE','DELETE'], to: 'ClientEditor' }
  ]
  entity CostCenters as projection on db.CostCenters;

  @restrict: [
    { grant: 'READ', to: 'HRAdmin' },
    { grant: 'READ', to: 'HRViewer' },
    { grant: 'READ', to: 'HREditor' },

    { grant: 'READ', to: 'ClientViewer' },
    { grant: 'READ', to: 'ClientEditor' }
  ]
  entity Countries as projection on CommonCountries;
}

annotate ClientService.Clients with @odata.etag: 'modifiedAt';
annotate ClientService.Employees with @odata.etag: 'modifiedAt';
annotate ClientService.CostCenters with @odata.etag: 'modifiedAt';
