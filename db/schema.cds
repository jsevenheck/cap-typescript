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

type OutboxStatus : String enum {
  PENDING;
  PROCESSING;
  COMPLETED;
  DELIVERED;
  FAILED;
};

@odata.etag: 'modifiedAt'
@cds.persistence.indices: [
  { name: 'Clients_companyId_idx', unique: true, elements: ['companyId'] },
  { name: 'Clients_name_idx', elements: ['name'] }
]
entity Clients : managed, cuid {
  @mandatory
  @assert.format: '^[0-9]{4}$'
  @Core.Immutable
  companyId            : String(4) not null;
  @mandatory
  name                 : String(120) not null;
  employees            : Composition of many Employees on employees.client = $self;
  costCenters          : Composition of many CostCenters on costCenters.client = $self;
  locations            : Composition of many Locations on locations.client = $self;
  costCenterAssignments: Composition of many EmployeeCostCenterAssignments on costCenterAssignments.client = $self;
}

@odata.etag: 'modifiedAt'
@cds.persistence.indices: [
  { name: 'Locations_validFrom_validTo_idx', elements: ['validFrom', 'validTo'] },
  { name: 'Locations_client_city_idx', elements: ['client_ID', 'city'] },
  { name: 'Locations_country_idx', elements: ['country_code'] }
]
entity Locations : managed, cuid {
  @mandatory
  @assert.range: [1, 100]
  city          : String(100) not null;
  @mandatory
  country       : Association to CommonCountries not null;
  @mandatory
  @assert.range: [1, 20]
  zipCode       : String(20) not null;
  @mandatory
  @assert.range: [1, 200]
  street        : String(200) not null;
  addressSupplement : String(200);
  @mandatory
  validFrom     : Date not null;
  validTo       : Date;
  @mandatory
  client        : Association to Clients not null;
  employees     : Association to many Employees on employees.location = $self;
}

@odata.etag: 'modifiedAt'
@personalData: { dataSubject: 'Employee' }
@cds.persistence.indices: [
  { name: 'Employees_employeeId_idx', unique: true, elements: ['employeeId'] },
  { name: 'Employees_status_idx', elements: ['status'] },
  { name: 'Employees_employmentType_idx', elements: ['employmentType'] },
  { name: 'Employees_client_status_idx', elements: ['client_ID', 'status'] },
  { name: 'Employees_email_idx', elements: ['email'] },
  { name: 'Employees_entryDate_idx', elements: ['entryDate'] },
  { name: 'Employees_manager_idx', elements: ['manager_ID'] }
]
entity Employees : managed, cuid {
  @assert.unique: { name: 'Employees_employeeId_unique' }
  @mandatory
  @assert.format: '^[0-9]{4}-[0-9]{4}$'
  @Core.Immutable
  employeeId    : String(9)  not null;
  @mandatory
  @assert.range: [1, 60]
  firstName     : String(60)  not null;
  @mandatory
  @assert.range: [1, 60]
  lastName      : String(60)  not null;
  @mandatory @assert.format: '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
  email         : String(120) not null;
  @sap.common.PersonalData.IsPotentiallyPersonal
  @assert.format: '^$|^\+?[0-9][0-9\s\-\(\)\.]{0,28}$'
  phoneNumber   : String(30);
  @mandatory
  location      : Association to Locations not null;
  @assert.range: [0, 40]
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
  { name: 'CostCenters_validFrom_validTo_idx', elements: ['validFrom', 'validTo'] },
  { name: 'CostCenters_responsible_idx', elements: ['responsible_ID'] },
  { name: 'CostCenters_client_valid_idx', elements: ['client_ID', 'validFrom', 'validTo'] }
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
  status        : OutboxStatus default 'PENDING';
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
  status          : OutboxStatus default 'FAILED';
  attempts        : Integer      not null;
  lastError       : LargeString;
  failedAt        : Timestamp    not null;
}
