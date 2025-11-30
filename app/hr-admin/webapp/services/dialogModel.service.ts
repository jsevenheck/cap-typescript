import Controller from "sap/ui/core/mvc/Controller";
import View from "sap/ui/core/mvc/View";
import JSONModel from "sap/ui/model/json/JSONModel";

import {
  AssignmentDialogModelData,
  ClientDialogModelData,
  CostCenterDialogModelData,
  EmployeeDialogModelData,
  LocationDialogModelData,
  ViewState,
} from "../types/DialogTypes";

type DialogJSONModel<T> = JSONModel & {
  getData(): T;
  setData(data: T): void;
  setProperty(path: string, value: unknown): void;
  getProperty(path: string): unknown;
};

export default class DialogModelAccessor {
  constructor(private readonly controller: Controller) {}

  public getClientModel(): DialogJSONModel<ClientDialogModelData> {
    return this.getTypedModel<ClientDialogModelData>("dialog");
  }

  public getEmployeeModel(): DialogJSONModel<EmployeeDialogModelData> {
    return this.getTypedModel<EmployeeDialogModelData>("employeeDialog");
  }

  public getCostCenterModel(): DialogJSONModel<CostCenterDialogModelData> {
    return this.getTypedModel<CostCenterDialogModelData>("costCenterDialog");
  }

  public getLocationModel(): DialogJSONModel<LocationDialogModelData> {
    return this.getTypedModel<LocationDialogModelData>("locationDialog");
  }

  public getAssignmentModel(): DialogJSONModel<AssignmentDialogModelData> {
    return this.getTypedModel<AssignmentDialogModelData>("assignmentDialog");
  }

  public getViewStateModel(): DialogJSONModel<ViewState> {
    return this.getTypedModel<ViewState>("view");
  }

  private getView(): View {
    const view = this.controller.getView();
    if (!view) {
      throw new Error("View is not available on the controller instance.");
    }
    return view;
  }

  private getTypedModel<T>(name: string): DialogJSONModel<T> {
    const model = this.getView().getModel(name) as DialogJSONModel<T> | undefined;
    if (!model) {
      throw new Error(`Expected model "${name}" to be available on the view.`);
    }
    return model;
  }
}
