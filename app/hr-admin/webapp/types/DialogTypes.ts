export type DialogMode = "create" | "edit";

export type EmployeeStatusKey = "active" | "inactive";

export type EmploymentTypeKey = "internal" | "external";

export interface SelectOption {
  key: string;
  text: string;
}

export interface ClientDialogData {
  ID?: string;
  companyId: string;
  name: string;
}

export interface ClientDialogModelData {
  mode: DialogMode;
  title: string;
  client: ClientDialogData;
}

export interface EmployeeDialogData {
  ID?: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  costCenter_ID?: string;
  manager_ID?: string;
  managerName: string;
  location_ID?: string;
  positionLevel: string;
  entryDate: string;
  exitDate: string;
  status: EmployeeStatusKey;
  employmentType: EmploymentTypeKey;
}

export interface EmployeeDialogModelData {
  mode: DialogMode;
  title: string;
  employee: EmployeeDialogData;
  managerLookupPending: boolean;
}

export interface AssignmentDialogData {
  ID?: string;
  costCenter_ID?: string;
  validFrom: string;
  validTo?: string;
  isResponsible: boolean;
}

export interface AssignmentDialogModelData {
  mode: DialogMode;
  title: string;
  assignment: AssignmentDialogData;
}

export interface CostCenterDialogData {
  ID?: string;
  code: string;
  name: string;
  description: string;
  responsible_ID?: string;
}

export interface CostCenterDialogModelData {
  mode: DialogMode;
  title: string;
  costCenter: CostCenterDialogData;
}

export interface LocationDialogData {
  ID?: string;
  city: string;
  country_code: string;
  zipCode: string;
  street: string;
  addressSupplement?: string;
  validFrom: string;
  validTo?: string;
}

export interface LocationDialogModelData {
  mode: DialogMode;
  title: string;
  location: LocationDialogData;
}

export interface ViewState {
  selectedClientId?: string;
  selectedEmployeeId?: string;
  selectedCostCenterId?: string;
  selectedLocationId?: string;
  selectedAssignmentId?: string;
  selectedTabKey: string;
  anonymizeBefore?: string;
  statisticsExpanded?: boolean;
  statisticsLoading?: boolean;
}

export interface AuthorizationState {
  canWrite: boolean;
  isAdmin: boolean;
  isReadOnly: boolean;
  loaded: boolean;
}
