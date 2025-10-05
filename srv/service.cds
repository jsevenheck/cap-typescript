// srv/service.cds
using { clientmgmt as db } from '../db/schema';
using { sap.common.Countries as CommonCountries } from '@sap/cds/common';

service ClientService @(path:'/clients') {
  @restrict: [
    { grant: 'READ', to: 'ClientViewer' },
    { grant: ['CREATE','UPDATE','DELETE'], to: 'ClientEditor' }
  ]
  entity Clients as projection on db.Clients {
    *,
    employees: redirected to Employees,
    costCenters: redirected to CostCenters
  };

  @restrict: [
    { grant: 'READ', to: 'ClientViewer' },
    { grant: ['CREATE','UPDATE','DELETE'], to: 'ClientEditor' }
  ]
  entity Employees as projection on db.Employees;

  @restrict: [
    { grant: 'READ', to: 'ClientViewer' },
    { grant: ['CREATE','UPDATE','DELETE'], to: 'ClientEditor' }
  ]
  entity CostCenters as projection on db.CostCenters;

  @restrict: [
    { grant: 'READ', to: 'ClientViewer' },
    { grant: 'READ', to: 'ClientEditor' }
  ]
  entity Countries as projection on CommonCountries;
}
