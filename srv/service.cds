// srv/service.cds
using { clientmgmt as db } from '../db/schema';
using { sap.common.Countries as CommonCountries } from '@sap/cds/common';

service ClientService @(path:'/odata/v4/clients', impl:'./handlers.ts') {
  @restrict: [
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HRAdmin' },
    { grant: 'READ', to: 'HRViewer',  where: '(companyId in $user.CompanyCode or companyId in $user.companyCodes)' },
    {
      grant: ['READ','CREATE','UPDATE','DELETE'],
      to: 'HREditor',
      where: '(companyId in $user.CompanyCode or companyId in $user.companyCodes)',
    }
  ]
  @description: 'Updating or deleting a client requires optimistic concurrency control: supply an If-Match header when the service exposes ETags or include the latest modifiedAt timestamp in the payload.'
  entity Clients as projection on db.Clients {
    *,
    employees: redirected to Employees,
    costCenters: redirected to CostCenters
  };

  @restrict: [
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HRAdmin' },
    {
      grant: 'READ',
      to: 'HRViewer',
      where: '(client.companyId in $user.CompanyCode or client.companyId in $user.companyCodes)',
    },
    {
      grant: ['READ','CREATE','UPDATE','DELETE'],
      to: 'HREditor',
      where: '(client.companyId in $user.CompanyCode or client.companyId in $user.companyCodes)',
    }
  ]
  @description: 'Updating or deleting an employee requires either an If-Match header carrying the latest ETag or the modifiedAt value in the payload to satisfy optimistic concurrency checks.'
  entity Employees as projection on db.Employees;

  @restrict: [
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HRAdmin' },
    {
      grant: 'READ',
      to: 'HRViewer',
      where: '(client.companyId in $user.CompanyCode or client.companyId in $user.companyCodes)',
    },
    {
      grant: ['READ','CREATE','UPDATE','DELETE'],
      to: 'HREditor',
      where: '(client.companyId in $user.CompanyCode or client.companyId in $user.companyCodes)',
    }
  ]
  @description: 'Updating or deleting a cost center requires concurrency metadata: include an If-Match header if the entity publishes ETags or provide the current modifiedAt timestamp in the payload.'
  entity CostCenters as projection on db.CostCenters;

  @restrict: [
    { grant: 'READ', to: 'HRAdmin' },
    { grant: 'READ', to: 'HRViewer' },
    { grant: 'READ', to: 'HREditor' }
  ]
  entity Countries as projection on CommonCountries;

  @requires: ['HREditor', 'HRAdmin']
  action anonymizeFormerEmployees(before: Date) returns Integer;
}
