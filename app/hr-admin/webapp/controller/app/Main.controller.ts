import Controller from "sap/ui/core/mvc/Controller";
import Event from "sap/ui/base/Event";
import JSONModel from "sap/ui/model/json/JSONModel";
import Router from "sap/ui/core/routing/Router";
import Route from "sap/ui/core/routing/Route";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";

import initializeModels from "../../model/modelInitialization";
import ClientHandler from "../clients/ClientHandler.controller";
import CostCenterHandler from "../costCenters/CostCenterHandler.controller";
import EmployeeHandler from "../employees/EmployeeHandler.controller";
import LocationHandler from "../locations/LocationHandler.controller";
import NavigationService from "../../core/navigation/NavigationService";
import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import CacheManager from "../../services/cacheManager.service";
import { AuthorizationService } from "../../core/authorization/AuthorizationService";
import UnsavedChangesGuard from "../../core/guards/UnsavedChangesGuard";

export default class Main extends Controller {
  private models!: DialogModelAccessor;
  private selection!: SelectionState;
  private navigation!: NavigationService;
  private guard!: UnsavedChangesGuard;
  private cacheManager!: CacheManager;
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
    this.guard = new UnsavedChangesGuard();
    this.navigation = new NavigationService(this, this.selection);

    // Initialize cache manager
    const odataModel = view.getModel() as ODataModel;
    this.cacheManager = new CacheManager(odataModel);

    // Initialize entity handlers
    this.clients = new ClientHandler(this, this.models, this.selection, this.navigation, this.guard);
    this.employees = new EmployeeHandler(this, this.models, this.selection, this.guard);
    this.costCenters = new CostCenterHandler(this, this.models, this.selection, this.guard);
    this.locations = new LocationHandler(this, this.models, this.selection, this.guard);

    // Initialize router and attach navigation guards
    const router = this.getOwnerComponent()?.getRouter();
    if (router) {
      this.attachNavigationGuards(router);
      router.initialize();
    }

    // Load user authorization information
    this.loadAuthorizationInfo();

    // Setup periodic cache cleanup (every 5 minutes)
    this.setupCacheCleanup();
  }

  /**
   * Attach navigation guards to all routes to check for unsaved changes
   */
  private attachNavigationGuards(router: Router): void {
    const routes = ["clients", "employees", "costCenters", "locations"];

    routes.forEach((routeName) => {
      const route = router.getRoute(routeName);
      if (route) {
        route.attachBeforeMatched(this.onBeforeRouteMatched.bind(this));
      }
    });

    // Attach pattern matched handlers to bind pages to client context
    const employeesRoute = router.getRoute("employees");
    if (employeesRoute) {
      employeesRoute.attachPatternMatched(this.onEmployeesRouteMatched.bind(this));
    }

    const costCentersRoute = router.getRoute("costCenters");
    if (costCentersRoute) {
      costCentersRoute.attachPatternMatched(this.onCostCentersRouteMatched.bind(this));
    }

    const locationsRoute = router.getRoute("locations");
    if (locationsRoute) {
      locationsRoute.attachPatternMatched(this.onLocationsRouteMatched.bind(this));
    }
  }

  /**
   * Called before a route is matched - check for unsaved changes
   */
  private onBeforeRouteMatched(event: Event): void {
    const i18n = this.getI18nBundle();

    // If there are unsaved changes, show confirmation
    if (this.guard.hasDirtyForms()) {
      // Prevent route navigation
      event.preventDefault();

      // Get route details for pending navigation
      const route = event.getSource() as Route;
      const args = event.getParameter("arguments");

      // Ask user to confirm
      this.guard.checkNavigation(i18n, () => {
        // User confirmed - manually trigger navigation
        const router = this.getOwnerComponent()?.getRouter();
        if (router && route) {
          router.navTo(route.getPattern(), args);
        }
      });
    }
  }

  /**
   * Get i18n resource bundle for localized messages
   */
  private getI18nBundle(): ResourceBundle {
    const view = this.getView();
    const model = view?.getModel("i18n") as ResourceModel;
    return model.getResourceBundle() as ResourceBundle;
  }

  /**
   * Handle employees route matched - bind page to client context
   */
  private onEmployeesRouteMatched(event: Event): void {
    const args = event.getParameter("arguments") as { clientId: string };
    const clientId = args?.clientId;

    if (!clientId) {
      console.error("No clientId in route parameters");
      return;
    }

    // Bind all detail pages to the client entity
    const clientPath = `/Clients('${clientId}')`;
    const employeesPage = this.byId("employeesPage");
    const costCentersPage = this.byId("costCentersPage");
    const locationsPage = this.byId("locationsPage");

    // Use bindElement to properly bind the page to the client context
    // This handles async loading and context lifecycle automatically
    if (employeesPage) {
      employeesPage.bindElement({ path: clientPath });
    }
    if (costCentersPage) {
      costCentersPage.bindElement({ path: clientPath });
    }
    if (locationsPage) {
      locationsPage.bindElement({ path: clientPath });
    }

    // Update selection state with the context once available
    const context = employeesPage?.getBindingContext();
    if (context) {
      this.selection.setClient(context);
      this.selection.clearEmployee();
      this.selection.clearCostCenter();
      this.selection.clearLocation();
    }
  }

  /**
   * Handle cost centers route matched - bind page to client context
   */
  private onCostCentersRouteMatched(event: Event): void {
    const args = event.getParameter("arguments") as { clientId: string };
    const clientId = args?.clientId;

    if (!clientId) {
      console.error("No clientId in route parameters");
      return;
    }

    // Bind all detail pages to the client entity
    const clientPath = `/Clients('${clientId}')`;
    const costCentersPage = this.byId("costCentersPage");
    const employeesPage = this.byId("employeesPage");
    const locationsPage = this.byId("locationsPage");

    // Use bindElement to properly bind the page to the client context
    if (costCentersPage) {
      costCentersPage.bindElement({ path: clientPath });
    }
    if (employeesPage) {
      employeesPage.bindElement({ path: clientPath });
    }
    if (locationsPage) {
      locationsPage.bindElement({ path: clientPath });
    }

    // Update selection state
    const context = costCentersPage?.getBindingContext();
    if (context) {
      this.selection.setClient(context);
      this.selection.clearEmployee();
      this.selection.clearCostCenter();
      this.selection.clearLocation();
    }
  }

  /**
   * Handle locations route matched - bind page to client context
   */
  private onLocationsRouteMatched(event: Event): void {
    const args = event.getParameter("arguments") as { clientId: string };
    const clientId = args?.clientId;

    if (!clientId) {
      console.error("No clientId in route parameters");
      return;
    }

    // Bind all detail pages to the client entity
    const clientPath = `/Clients('${clientId}')`;
    const locationsPage = this.byId("locationsPage");
    const employeesPage = this.byId("employeesPage");
    const costCentersPage = this.byId("costCentersPage");

    // Use bindElement to properly bind the page to the client context
    if (locationsPage) {
      locationsPage.bindElement({ path: clientPath });
    }
    if (employeesPage) {
      employeesPage.bindElement({ path: clientPath });
    }
    if (costCentersPage) {
      costCentersPage.bindElement({ path: clientPath });
    }

    // Update selection state
    const context = locationsPage?.getBindingContext();
    if (context) {
      this.selection.setClient(context);
      this.selection.clearEmployee();
      this.selection.clearCostCenter();
      this.selection.clearLocation();
    }
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
   * Setup periodic cache cleanup to remove expired entries
   * Runs every 5 minutes to free up storage space
   */
  private setupCacheCleanup(): void {
    // Run cleanup every 5 minutes
    const cleanupInterval = 5 * 60 * 1000;
    setInterval(() => {
      this.cacheManager.clearExpired();
    }, cleanupInterval);

    // Run initial cleanup after 1 minute
    setTimeout(() => {
      this.cacheManager.clearExpired();
    }, 60000);
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
    // Clear client entity cache and refresh list
    this.cacheManager.clearEntity('Clients');
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
    // Clear employee entity cache and refresh list
    this.cacheManager.clearEntity('employees');
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
    // Clear cost center entity cache and refresh list
    this.cacheManager.clearEntity('costCenters');
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
    // Clear location entity cache and refresh list
    this.cacheManager.clearEntity('locations');
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
