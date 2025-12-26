// srv/service.cds
using { clientmgmt as db } from '../db/schema';
using { sap.common.Countries as CommonCountries } from '@sap/cds/common';

// The global OData prefix is configured via cds.odata.urlPath (see package.json),
// so the service-specific path only needs the relative segment.
service ClientService @(path:'/clients', impl:'./handlers.ts') {
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
    costCenters: redirected to CostCenters,
    locations: redirected to Locations
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
  @description: 'Updating or deleting a location requires optimistic concurrency control: supply an If-Match header when the service exposes ETags or include the latest modifiedAt timestamp in the payload.'
  entity Locations as projection on db.Locations;

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
  @description: 'Employee cost center assignments with date ranges for tracking historical and future cost center allocations. Updating or deleting an assignment requires optimistic concurrency control: supply an If-Match header when the service exposes ETags or include the latest modifiedAt timestamp in the payload.'
  entity EmployeeCostCenterAssignments as projection on db.EmployeeCostCenterAssignments;

  @restrict: [
    { grant: 'READ', to: 'HRAdmin' },
    { grant: 'READ', to: 'HRViewer' },
    { grant: 'READ', to: 'HREditor' }
  ]
  entity Countries as projection on CommonCountries;

  @requires: ['HREditor', 'HRAdmin']
  action anonymizeFormerEmployees(before: Date) returns Integer;

  /**
   * Get current user information including roles and attributes.
   * Used by frontend to adapt UI based on user permissions.
   */
  @readonly
  @requires: ['HRAdmin', 'HREditor', 'HRViewer']
  function userInfo() returns {
    roles: array of String;
    attributes: {
      CompanyCode: array of String;
      companyCodes: array of String;
    };
  };

  /**
   * Get employee statistics for dashboard.
   * Returns aggregated counts for employees by status and employment type.
   * @param clientId - Optional client ID to filter statistics for a specific client
   */
  @readonly
  @requires: ['HRAdmin', 'HREditor', 'HRViewer']
  function employeeStatistics(clientId: UUID) returns {
    totalEmployees: Integer;
    activeEmployees: Integer;
    inactiveEmployees: Integer;
    internalEmployees: Integer;
    externalEmployees: Integer;
    managersCount: Integer;
    recentHires: Integer;
    upcomingExits: Integer;
  };
}
