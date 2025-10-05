import Controller from "sap/ui/core/mvc/Controller";
import Event from "sap/ui/base/Event";

import initializeModels from "./models/modelInitialization";
import ClientHandler from "./handlers/ClientHandler";
import CostCenterHandler from "./handlers/CostCenterHandler";
import EmployeeHandler from "./handlers/EmployeeHandler";
import NavigationHandler from "./handlers/NavigationHandler";
import DialogModelAccessor from "./state/DialogModelAccessor";
import SelectionState from "./state/SelectionState";

export default class Main extends Controller {
  private models!: DialogModelAccessor;
  private selection!: SelectionState;
  private navigation!: NavigationHandler;
  private clients!: ClientHandler;
  private employees!: EmployeeHandler;
  private costCenters!: CostCenterHandler;

  public onInit(): void {
    const view = this.getView();
    if (!view) {
      return;
    }

    initializeModels(view);
    this.models = new DialogModelAccessor(this);
    this.selection = new SelectionState(this, this.models);
    this.navigation = new NavigationHandler(this, this.selection);
    this.clients = new ClientHandler(this, this.models, this.selection, this.navigation);
    this.employees = new EmployeeHandler(this, this.models, this.selection);
    this.costCenters = new CostCenterHandler(this, this.models, this.selection);
  }

  public onRefresh(): void {
    this.clients.refresh();
  }

  public onAddClient(): void {
    this.clients.startCreate();
  }

  public onEditClient(): void {
    this.clients.startEdit();
  }

  public onDeleteClient(): void {
    this.clients.delete();
  }

  public onSaveClient(): void {
    this.clients.save();
  }

  public onCancelClient(): void {
    this.clients.cancel();
  }

  public onDialogAfterClose(): void {
    this.clients.afterDialogClose();
  }

  public onSelectionChange(event: Event): void {
    this.clients.handleSelectionChange(event);
  }

  public onClientPress(event: Event): void {
    this.clients.handleClientPress(event);
  }

  public onBackToClients(): void {
    this.navigation.backToClients();
  }

  public onRefreshEmployees(): void {
    this.employees.refresh();
  }

  public onAddEmployee(): void {
    this.employees.startCreate();
  }

  public onEditEmployee(): Promise<void> {
    return this.employees.startEdit();
  }

  public onDeleteEmployee(): void {
    this.employees.delete();
  }

  public onSaveEmployee(): void {
    this.employees.save();
  }

  public onCancelEmployee(): void {
    this.employees.cancel();
  }

  public onEmployeeDialogAfterClose(): void {
    this.employees.afterDialogClose();
  }

  public onEmployeesSelectionChange(event: Event): void {
    this.employees.handleSelectionChange(event);
  }

  public onNavigateToCostCenters(): void {
    if (this.selection.ensureClientSelected()) {
      this.navigation.showCostCentersPage();
    }
  }

  public onBackToEmployees(): void {
    this.navigation.backToEmployees();
  }

  public onRefreshCostCenters(): void {
    this.costCenters.refresh();
  }

  public onAddCostCenter(): void {
    this.costCenters.startCreate();
  }

  public onEditCostCenter(): Promise<void> {
    return this.costCenters.startEdit();
  }

  public onDeleteCostCenter(): void {
    this.costCenters.delete();
  }

  public onSaveCostCenter(): void {
    this.costCenters.save();
  }

  public onCancelCostCenter(): void {
    this.costCenters.cancel();
  }

  public onCostCenterDialogAfterClose(): void {
    this.costCenters.afterDialogClose();
  }

  public onCostCentersSelectionChange(event: Event): void {
    this.costCenters.handleSelectionChange(event);
  }

  public onEmployeeCostCenterChange(event: Event): void {
    this.employees.handleCostCenterChange(event);
  }
}
