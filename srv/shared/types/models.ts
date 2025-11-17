export interface ClientEntity {
  ID: string;
  companyId: string;
  name?: string;
  notificationEndpoint?: string;
}

export interface LocationEntity {
  ID: string;
  city: string;
  country_code: string;
  zipCode: string;
  street: string;
  addressSupplement?: string | null;
  validFrom: string;
  validTo?: string | null;
  client_ID: string;
}

export interface EmployeeEntity {
  ID: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  location_ID: string;
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
