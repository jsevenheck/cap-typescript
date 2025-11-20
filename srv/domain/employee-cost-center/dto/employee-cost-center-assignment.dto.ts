export interface EmployeeCostCenterAssignmentEntity {
  ID: string;
  employee_ID: string;
  costCenter_ID: string;
  validFrom: string;
  validTo?: string | null;
  isResponsible: boolean;
  client_ID: string;
}

export interface EmployeeEntity {
  ID: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  client_ID: string;
  isManager?: boolean;
}

export interface CostCenterEntity {
  ID: string;
  code: string;
  name: string;
  client_ID: string;
  responsible_ID: string;
  validFrom: string;
  validTo?: string | null;
}

export interface ClientEntity {
  ID: string;
  companyId: string;
}
