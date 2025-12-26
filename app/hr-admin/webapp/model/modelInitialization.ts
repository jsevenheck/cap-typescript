import View from 'sap/ui/core/mvc/View';
import JSONModel from 'sap/ui/model/json/JSONModel';

import {
  AuthorizationState,
  AssignmentDialogModelData,
  ClientDialogModelData,
  CostCenterDialogModelData,
  EmployeeDialogModelData,
  EmployeeStatusKey,
  EmploymentTypeKey,
  LocationDialogModelData,
  ViewState,
} from '../types/DialogTypes';
import {
  COUNTRY_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  STATUS_OPTIONS,
} from '../constants/selectOptions';
import { getEmptyStatistics } from '../services/statistics.service';

const DEFAULT_STATUS: EmployeeStatusKey = 'active';
const DEFAULT_EMPLOYMENT_TYPE: EmploymentTypeKey = 'internal';

export function createInitialClientDialogData(): ClientDialogModelData {
  return {
    mode: 'create',
    title: '',
    client: {
      companyId: '',
      name: '',
    },
  };
}

export function createInitialEmployeeDialogData(): EmployeeDialogModelData {
  return {
    mode: 'create',
    title: '',
    employee: {
      employeeId: '',
      firstName: '',
      lastName: '',
      email: '',
      costCenter_ID: undefined,
      manager_ID: undefined,
      managerName: '',
      location_ID: undefined,
      positionLevel: '',
      entryDate: '',
      exitDate: '',
      status: DEFAULT_STATUS,
      employmentType: DEFAULT_EMPLOYMENT_TYPE,
    },
    managerLookupPending: false,
  };
}

export function createInitialCostCenterDialogData(): CostCenterDialogModelData {
  return {
    mode: 'create',
    title: '',
    costCenter: {
      code: '',
      name: '',
      description: '',
      responsible_ID: undefined,
    },
  };
}

export function createInitialLocationDialogData(): LocationDialogModelData {
  return {
    mode: 'create',
    title: '',
    location: {
      city: '',
      country_code: '',
      zipCode: '',
      street: '',
      addressSupplement: '',
      validFrom: '',
      validTo: '',
    },
  };
}

export function createInitialViewState(): ViewState {
  return {
    selectedTabKey: 'clients',
    anonymizeBefore: '',
    statisticsExpanded: false,
  };
}

export function createInitialAssignmentDialogData(): AssignmentDialogModelData {
  return {
    mode: 'create',
    title: '',
    assignment: {
      costCenter_ID: undefined,
      validFrom: '',
      validTo: '',
      isResponsible: false,
    },
  };
}

export function createInitialAuthorizationState(): AuthorizationState {
  // In local development, default to full access so UI is usable.
  // Backend authorization still enforces real security.
  return {
    canWrite: true,
    isAdmin: true,
    isReadOnly: false,
    loaded: false,
  };
}

export default function initializeModels(view: View): void {
  view.setModel(new JSONModel(createInitialClientDialogData()), 'dialog');
  view.setModel(new JSONModel(createInitialEmployeeDialogData()), 'employeeDialog');
  view.setModel(new JSONModel(createInitialCostCenterDialogData()), 'costCenterDialog');
  view.setModel(new JSONModel(createInitialLocationDialogData()), 'locationDialog');
  view.setModel(new JSONModel(createInitialAssignmentDialogData()), 'assignmentDialog');
  view.setModel(new JSONModel(createInitialViewState()), 'view');
  view.setModel(new JSONModel(createInitialAuthorizationState()), 'auth');
  view.setModel(new JSONModel(STATUS_OPTIONS), 'statusOptions');
  view.setModel(new JSONModel(EMPLOYMENT_TYPE_OPTIONS), 'employmentTypeOptions');
  view.setModel(new JSONModel(COUNTRY_OPTIONS), 'countryOptions');
  view.setModel(new JSONModel(getEmptyStatistics()), 'statistics');
}
