// db/schema.cds
using {
  cuid,
  managed,
  sap.common.Countries as CommonCountries,
} from '@sap/cds/common';

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
  companyId            : String(40) not null;
  name                 : String(120);
  notificationEndpoint : String(500);
  employees            : Composition of many Employees on employees.client = $self;
  costCenters          : Composition of many CostCenters on costCenters.client = $self;
  locations            : Composition of many Locations on locations.client = $self;
  costCenterAssignments: Composition of many EmployeeCostCenterAssignments on costCenterAssignments.client = $self;
}

@odata.etag: 'modifiedAt'
entity Locations : managed, cuid {
  city          : String(100) not null;
  country       : Association to CommonCountries not null;
  zipCode       : String(20) not null;
  street        : String(200) not null;
  addressSupplement : String(200);
  validFrom     : Date not null;
  validTo       : Date;
  client        : Association to Clients not null;
  employees     : Association to many Employees on employees.location = $self;
}

@odata.etag: 'modifiedAt'
@personalData: { dataSubject: 'Employee' }
entity Employees : managed, cuid {
  @assert.unique: { name: 'Employees_employeeId_unique' }
  employeeId    : String(60)  not null;
  firstName     : String(60)  not null;
  lastName      : String(60)  not null;
  email         : String(120) not null;
  location      : Association to Locations not null;
  positionLevel : String(40);
  entryDate     : Date not null;
  exitDate      : Date;
  status        : EmployeeStatus default 'active';
  employmentType: EmploymentType default 'internal';
  isManager     : Boolean default false;
  @sap.common.PersonalData.IsPotentiallyPersonal
  anonymizedAt  : Timestamp;
  client        : Association to Clients not null;
  manager       : Association to Employees;
  costCenter    : Association to CostCenters;
  costCenterAssignments : Composition of many EmployeeCostCenterAssignments on costCenterAssignments.employee = $self;
}

entity EmployeeIdCounters {
  key client       : Association to Clients not null;
  lastCounter      : Integer default 0;
}


@odata.etag: 'modifiedAt'
@cds.persistence.indices: [
  { name: 'CostCenters_code_client_unique', unique: true, elements: ['client_ID', 'code'] }
]
entity CostCenters : managed, cuid {
  code         : String(40)  not null;
  name         : String(120) not null;
  description  : String(255);
  validFrom    : Date not null;
  validTo      : Date;
  client       : Association to Clients not null;
  responsible  : Association to Employees not null;
  employees    : Association to many Employees on employees.costCenter = $self;
  assignments  : Composition of many EmployeeCostCenterAssignments on assignments.costCenter = $self;
}

@odata.etag: 'modifiedAt'
@cds.persistence.indices: [
  { name: 'EmpCCAssign_emp_valid_idx', elements: ['employee_ID', 'validFrom', 'validTo'] }
]
entity EmployeeCostCenterAssignments : managed, cuid {
  employee      : Association to Employees not null;
  costCenter    : Association to CostCenters not null;
  validFrom     : Date not null;
  validTo       : Date;
  isResponsible : Boolean default false;
  client        : Association to Clients not null;
}

@cds.persistence.indices: [
  { name: 'Outbox_status_nextAttempt_idx', elements: ['status', 'nextAttemptAt'] }
]
entity EmployeeNotificationOutbox : managed, cuid {
  eventType     : String(60)  not null;
  destinationName: String(500) not null;
  payload       : LargeString not null;
  status        : String(20)  default 'PENDING';
  attempts      : Integer     default 0;
  nextAttemptAt : Timestamp;
  claimedAt     : Timestamp;
  claimedBy     : String(60);
  deliveredAt   : Timestamp;
  lastError     : LargeString;
}

// Dead Letter Queue for permanently failed messages
entity EmployeeNotificationDLQ : managed, cuid {
  originalID      : UUID         not null;
  eventType       : String(60)   not null;
  destinationName : String(500)  not null;
  payload         : LargeString  not null;
  attempts        : Integer      not null;
  lastError       : LargeString;
  failedAt        : Timestamp    not null;
}
