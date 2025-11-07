export interface ClientEntity {
  ID: string;
  companyId: string;
  name?: string;
  country_code: string;
  notificationEndpoint?: string;
  country_code_code?: string; // Association to Countries
}

export interface EmployeeEntity {
  ID: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  location?: string;
  positionLevel?: string;
  entryDate: string;
  exitDate?: string;
  status?: string;
  employmentType?: string;
  isManager?: boolean;
  anonymizedAt?: string;
  client_ID: string;
  manager_ID?: string;
  costCenter_ID?: string;
}

export interface CostCenterEntity {
  ID: string;
  code: string;
  name: string;
  description?: string;
  client_ID: string;
  responsible_ID: string;
}

export interface EmployeeIdCounterEntity {
  client_ID: string;
  lastCounter: number;
}
