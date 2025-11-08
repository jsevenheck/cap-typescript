import View from "sap/ui/core/mvc/View";
import JSONModel from "sap/ui/model/json/JSONModel";

import {
  ClientDialogModelData,
  CostCenterDialogModelData,
  EmployeeDialogModelData,
  EmployeeStatusKey,
  EmploymentTypeKey,
  ViewState,
} from "../types/DialogTypes";
import {
  COUNTRY_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  STATUS_OPTIONS,
} from "../constants/selectOptions";

const DEFAULT_STATUS: EmployeeStatusKey = "active";
const DEFAULT_EMPLOYMENT_TYPE: EmploymentTypeKey = "internal";

export function createInitialClientDialogData(): ClientDialogModelData {
  return {
    mode: "create",
    title: "",
    client: {
      companyId: "",
      name: "",
      country_code: "",
      notificationEndpoint: "",
    },
  };
}

export function createInitialEmployeeDialogData(): EmployeeDialogModelData {
  return {
    mode: "create",
    title: "",
    employee: {
      employeeId: "",
      firstName: "",
      lastName: "",
      email: "",
      costCenter_ID: undefined,
      manager_ID: undefined,
      managerName: "",
      location: "",
      positionLevel: "",
      entryDate: "",
      exitDate: "",
      status: DEFAULT_STATUS,
      employmentType: DEFAULT_EMPLOYMENT_TYPE,
    },
    managerLookupPending: false,
  };
}

export function createInitialCostCenterDialogData(): CostCenterDialogModelData {
  return {
    mode: "create",
    title: "",
    costCenter: {
      code: "",
      name: "",
      description: "",
      responsible_ID: undefined,
    },
  };
}

export function createInitialViewState(): ViewState {
  return {};
}

export default function initializeModels(view: View): void {
  view.setModel(new JSONModel(createInitialClientDialogData()), "dialog");
  view.setModel(new JSONModel(createInitialEmployeeDialogData()), "employeeDialog");
  view.setModel(new JSONModel(createInitialCostCenterDialogData()), "costCenterDialog");
  view.setModel(new JSONModel(createInitialViewState()), "view");
  view.setModel(new JSONModel(STATUS_OPTIONS), "statusOptions");
  view.setModel(new JSONModel(EMPLOYMENT_TYPE_OPTIONS), "employmentTypeOptions");
  view.setModel(new JSONModel(COUNTRY_OPTIONS), "countryOptions");
}
