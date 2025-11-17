import List from "sap/m/List";
import MessageBox from "sap/m/MessageBox";
import Controller from "sap/ui/core/mvc/Controller";
import Context from "sap/ui/model/odata/v4/Context";

import DialogModelAccessor from "./dialogModel.service";

export default class SelectionState {
  private clientContext?: Context;
  private employeeContext?: Context;
  private costCenterContext?: Context;
  private locationContext?: Context;
  private readonly clearingSelections = new Set<string>();

  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor
  ) {}

  public setClient(context?: Context): void {
    if (!context) {
      this.clearClient();
      return;
    }

    this.clientContext = context;
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedClientId", context.getProperty("ID"));
    this.clearEmployee();
    this.clearCostCenter();
    this.clearLocation();
  }

  public clearClient(): void {
    this.clientContext = undefined;
    this.clearListSelection("clientsList");
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedClientId", undefined);
    this.clearEmployee();
    this.clearCostCenter();
    this.clearLocation();
  }

  public getSelectedClientContext(): Context | undefined {
    return this.clientContext;
  }

  public getSelectedClientId(): string | undefined {
    return this.models.getViewStateModel().getProperty("/selectedClientId");
  }

  public ensureClientSelected(): boolean {
    if (!this.clientContext) {
      MessageBox.error("Select a client first.");
      return false;
    }
    return true;
  }

  public setEmployee(context?: Context): void {
    if (!context) {
      this.clearEmployee();
      return;
    }

    this.employeeContext = context;
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedEmployeeId", context.getProperty("ID"));
  }

  public clearEmployee(): void {
    this.employeeContext = undefined;
    this.clearListSelection("employeesList");
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedEmployeeId", undefined);
  }

  public getSelectedEmployeeContext(): Context | undefined {
    return this.employeeContext;
  }

  public ensureEmployeeSelected(): boolean {
    if (!this.employeeContext) {
      MessageBox.error("Select an employee first.");
      return false;
    }
    return true;
  }

  public setCostCenter(context?: Context): void {
    if (!context) {
      this.clearCostCenter();
      return;
    }

    this.costCenterContext = context;
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedCostCenterId", context.getProperty("ID"));
  }

  public clearCostCenter(): void {
    this.costCenterContext = undefined;
    this.clearListSelection("costCentersList");
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedCostCenterId", undefined);
  }

  public getSelectedCostCenterContext(): Context | undefined {
    return this.costCenterContext;
  }

  public ensureCostCenterSelected(): boolean {
    if (!this.costCenterContext) {
      MessageBox.error("Select a cost center first.");
      return false;
    }
    return true;
  }

  public setLocation(context?: Context): void {
    if (!context) {
      this.clearLocation();
      return;
    }

    this.locationContext = context;
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedLocationId", context.getProperty("ID"));
  }

  public clearLocation(): void {
    this.locationContext = undefined;
    this.clearListSelection("locationsList");
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedLocationId", undefined);
  }

  public getSelectedLocationContext(): Context | undefined {
    return this.locationContext;
  }

  public ensureLocationSelected(): boolean {
    if (!this.locationContext) {
      MessageBox.error("Select a location first.");
      return false;
    }
    return true;
  }

  public isClearingListSelection(listId: string): boolean {
    return this.clearingSelections.has(listId);
  }

  private clearListSelection(listId: string): void {
    const list = this.controller.byId(listId) as List | undefined;
    if (!list) {
      return;
    }

    if (this.clearingSelections.has(listId)) {
      return;
    }

    this.clearingSelections.add(listId);
    try {
      list.removeSelections(true, false);
    } finally {
      this.clearingSelections.delete(listId);
    }
  }
}
