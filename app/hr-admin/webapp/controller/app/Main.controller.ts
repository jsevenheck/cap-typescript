import Controller from "sap/ui/core/mvc/Controller";
import Event from "sap/ui/base/Event";
import JSONModel from "sap/ui/model/json/JSONModel";

import initializeModels from "../../model/modelInitialization";
import ClientHandler from "../clients/ClientHandler.controller";
import CostCenterHandler from "../costCenters/CostCenterHandler.controller";
import EmployeeHandler from "../employees/EmployeeHandler.controller";
import LocationHandler from "../locations/LocationHandler.controller";
import NavigationService from "../../core/navigation/NavigationService";
import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import { AuthorizationService } from "../../core/authorization/AuthorizationService";

export default class Main extends Controller {
  private models!: DialogModelAccessor;
  private selection!: SelectionState;
  private navigation!: NavigationService;
  private clients!: ClientHandler;
  private employees!: EmployeeHandler;
  private costCenters!: CostCenterHandler;
  private locations!: LocationHandler;

  public onInit(): void {
    const view = this.getView();
    if (!view) {
      return;
    }

    initializeModels(view);
    this.models = new DialogModelAccessor(this);
    this.selection = new SelectionState(this, this.models);
    this.navigation = new NavigationService(this, this.selection);
    this.clients = new ClientHandler(this, this.models, this.selection, this.navigation);
    this.employees = new EmployeeHandler(this, this.models, this.selection);
    this.costCenters = new CostCenterHandler(this, this.models, this.selection);
    this.locations = new LocationHandler(this, this.models, this.selection);

    // Load user authorization information
    this.loadAuthorizationInfo();
  }

  /**
   * Load user authorization information from the backend
   * and update the authorization model to control UI element visibility
   */
  private async loadAuthorizationInfo(): Promise<void> {
    const view = this.getView();
    if (!view) {
      return;
    }

    const authModel = view.getModel("auth") as JSONModel;
    if (!authModel) {
      console.error("Authorization model not found");
      return;
    }

    try {
      const canWrite = await AuthorizationService.canWrite();
      const isAdmin = await AuthorizationService.isAdmin();
      const isReadOnly = await AuthorizationService.isReadOnly();

      authModel.setData({
        canWrite,
        isAdmin,
        isReadOnly,
        loaded: true,
      });
    } catch (error) {
      console.error("Failed to load authorization info", error);
      // Keep default values (read-only)
      authModel.setProperty("/loaded", true);
    }
  }

  /**
   * Cleanup lifecycle method - called when controller is destroyed
   * Prevents memory leaks by destroying all service instances and models
   */
  public onExit(): void {
    // Destroy handler instances
    if (this.clients && typeof (this.clients as any).destroy === 'function') {
      (this.clients as any).destroy();
    }
    if (this.employees && typeof (this.employees as any).destroy === 'function') {
      (this.employees as any).destroy();
    }
    if (this.costCenters && typeof (this.costCenters as any).destroy === 'function') {
      (this.costCenters as any).destroy();
    }
    if (this.locations && typeof (this.locations as any).destroy === 'function') {
      (this.locations as any).destroy();
    }

    // Destroy service instances
    if (this.navigation && typeof (this.navigation as any).destroy === 'function') {
      (this.navigation as any).destroy();
    }
    if (this.selection && typeof (this.selection as any).destroy === 'function') {
      (this.selection as any).destroy();
    }
    if (this.models && typeof (this.models as any).destroy === 'function') {
      (this.models as any).destroy();
    }

    // Destroy JSON models created during initialization
    const view = this.getView();
    if (view) {
      const modelNames = ['dialog', 'employeeDialog', 'costCenterDialog', 'locationDialog', 'view', 'auth', 'statusOptions', 'employmentTypeOptions', 'countryOptions'];
      for (const modelName of modelNames) {
        const model = view.getModel(modelName);
        if (model && typeof model.destroy === 'function') {
          model.destroy();
        }
      }
    }

    // Clear authorization cache
    AuthorizationService.clearCache();
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

  public onNavigateToLocations(): void {
    if (this.selection.ensureClientSelected()) {
      this.navigation.showLocationsPage();
    }
  }

  public onRefreshLocations(): void {
    this.locations.refresh();
  }

  public onAddLocation(): void {
    this.locations.startCreate();
  }

  public onEditLocation(): Promise<void> {
    return this.locations.startEdit();
  }

  public onDeleteLocation(): void {
    this.locations.delete();
  }

  public onSaveLocation(): void {
    this.locations.save();
  }

  public onCancelLocation(): void {
    this.locations.cancel();
  }

  public onLocationDialogAfterClose(): void {
    this.locations.afterDialogClose();
  }

  public onLocationsSelectionChange(event: Event): void {
    this.locations.handleSelectionChange(event);
  }
}
