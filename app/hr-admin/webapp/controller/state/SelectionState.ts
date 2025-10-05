import List from "sap/m/List";
import MessageBox from "sap/m/MessageBox";
import Controller from "sap/ui/core/mvc/Controller";
import Context from "sap/ui/model/odata/v4/Context";

import DialogModelAccessor from "./DialogModelAccessor";

export default class SelectionState {
  private clientContext?: Context;
  private employeeContext?: Context;
  private costCenterContext?: Context;

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
    viewModel.setProperty("/selectedClientName", context.getProperty("name"));
    viewModel.setProperty("/selectedClientCompanyId", context.getProperty("companyId"));
    this.clearEmployee();
    this.clearCostCenter();
  }

  public clearClient(): void {
    this.clientContext = undefined;
    this.clearListSelection("clientsList");
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedClientId", undefined);
    viewModel.setProperty("/selectedClientName", undefined);
    viewModel.setProperty("/selectedClientCompanyId", undefined);
    this.clearEmployee();
    this.clearCostCenter();
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

  private clearListSelection(listId: string): void {
    const list = this.controller.byId(listId) as List | undefined;
    list?.removeSelections(true);
  }
}
