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
  @mandatory @assert.unique: { name: 'Clients_companyId_unique' }
  companyId            : String(40) not null;
  @mandatory
  name                 : String(120) not null;
  employees            : Composition of many Employees on employees.client = $self;
  costCenters          : Composition of many CostCenters on costCenters.client = $self;
  locations            : Composition of many Locations on locations.client = $self;
  costCenterAssignments: Composition of many EmployeeCostCenterAssignments on costCenterAssignments.client = $self;
}

@odata.etag: 'modifiedAt'
@cds.persistence.indices: [
  { name: 'Locations_validFrom_validTo_idx', elements: ['validFrom', 'validTo'] }
]
entity Locations : managed, cuid {
  @mandatory
  city          : String(100) not null;
  @mandatory
  country       : Association to CommonCountries not null;
  @mandatory
  zipCode       : String(20) not null;
  @mandatory
  street        : String(200) not null;
  addressSupplement : String(200);
  @mandatory
  validFrom     : Date not null;
  validTo       : Date;
  client        : Association to Clients not null;
  employees     : Association to many Employees on employees.location = $self;
}

@odata.etag: 'modifiedAt'
@personalData: { dataSubject: 'Employee' }
@cds.persistence.indices: [
  { name: 'Employees_status_idx', elements: ['status'] },
  { name: 'Employees_employmentType_idx', elements: ['employmentType'] },
  { name: 'Employees_client_status_idx', elements: ['client_ID', 'status'] }
]
entity Employees : managed, cuid {
  @assert.unique: { name: 'Employees_employeeId_unique' }
  @mandatory
  employeeId    : String(60)  not null;
  @mandatory
  firstName     : String(60)  not null;
  @mandatory
  lastName      : String(60)  not null;
  @mandatory @assert.format: '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
  email         : String(120) not null;
  @mandatory
  location      : Association to Locations not null;
  positionLevel : String(40);
  @mandatory
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
  { name: 'CostCenters_code_client_unique', unique: true, elements: ['client_ID', 'code'] },
  { name: 'CostCenters_validFrom_validTo_idx', elements: ['validFrom', 'validTo'] }
]
entity CostCenters : managed, cuid {
  @mandatory
  code         : String(40)  not null;
  @mandatory
  name         : String(120) not null;
  description  : String(255);
  @mandatory
  validFrom    : Date not null;
  validTo      : Date;
  @mandatory
  client       : Association to Clients not null;
  @mandatory
  responsible  : Association to Employees not null;
  employees    : Association to many Employees on employees.costCenter = $self;
  assignments  : Composition of many EmployeeCostCenterAssignments on assignments.costCenter = $self;
}

@odata.etag: 'modifiedAt'
@cds.persistence.indices: [
  { name: 'EmpCCAssign_emp_valid_idx', elements: ['employee_ID', 'validFrom', 'validTo'] },
  { name: 'EmpCCAssign_cc_valid_idx', elements: ['costCenter_ID', 'validFrom', 'validTo'] },
  { name: 'EmpCCAssign_responsible_idx', elements: ['costCenter_ID', 'isResponsible'] }
]
entity EmployeeCostCenterAssignments : managed, cuid {
  @mandatory
  employee      : Association to Employees not null;
  @mandatory
  costCenter    : Association to CostCenters not null;
  @mandatory
  validFrom     : Date not null;
  validTo       : Date;
  isResponsible : Boolean default false;
  @mandatory
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

