// db/schema.cds
using { cuid, managed, sap.common.Countries as CommonCountries } from '@sap/cds/common';

namespace clientmgmt;

type EmployeeStatus : String enum {
  active;
  inactive;
};

type EmploymentType : String enum {
  internal;
  external;
};

@odata.etag: 'modifiedAt'
@cds.persistence.indices: [
  { name: 'Clients_companyId_idx', elements: ['companyId'] }
]
entity Clients : managed, cuid {
  @assert.unique: { name: 'Clients_companyId_unique' }
  companyId  : String(40) not null;
  name       : String(120);
  country    : Association to CommonCountries not null;
  employees  : Composition of many Employees on employees.client = $self;
  costCenters: Composition of many CostCenters on costCenters.client = $self;
}

@odata.etag: 'modifiedAt'
entity Employees : managed, cuid {
  @assert.unique: { name: 'Employees_employeeId_unique' }
  employeeId    : String(60)  not null;
  firstName     : String(60)  not null;
  lastName      : String(60)  not null;
  email         : String(120) not null;
  location      : String(80);
  positionLevel : String(40);
  entryDate     : Date not null;
  exitDate      : Date;
  status        : EmployeeStatus default 'active';
  employmentType: EmploymentType default 'internal';
  client        : Association to Clients not null;
  manager       : Association to Employees;
  costCenter    : Association to CostCenters;
}

entity EmployeeIdCounters {
  key client       : Association to Clients not null;
  lastCounter      : Integer default 0;
}


@odata.etag: 'modifiedAt'
entity CostCenters : managed, cuid {
  code         : String(40)  not null;
  name         : String(120) not null;
  description  : String(255);
  client       : Association to Clients not null;
  responsible  : Association to Employees not null;
  employees    : Association to many Employees on employees.costCenter = $self;
}
