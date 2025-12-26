import Controller from "sap/ui/core/mvc/Controller";
import Dialog from "sap/m/Dialog";
import List from "sap/m/List";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import SearchField from "sap/m/SearchField";
import Event from "sap/ui/base/Event";
import JSONModel from "sap/ui/model/json/JSONModel";
import Router from "sap/ui/core/routing/Router";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Log from "sap/base/Log";

import initializeModels from "../../model/modelInitialization";
import ClientHandler from "../clients/ClientHandler.controller";
import CostCenterHandler from "../costCenters/CostCenterHandler.controller";
import EmployeeHandler from "../employees/EmployeeHandler.controller";
import AssignmentHandler from "../assignments/AssignmentHandler.controller";
import LocationHandler from "../locations/LocationHandler.controller";
import NavigationService from "../../core/navigation/NavigationService";
import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import CacheManager from "../../services/cacheManager.service";
import { AuthorizationService } from "../../core/authorization/AuthorizationService";
import UnsavedChangesGuard from "../../core/guards/UnsavedChangesGuard";
import HashChanger from "sap/ui/core/routing/HashChanger";

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
  private assignments!: AssignmentHandler;
  private cacheCleanupIntervalId?: number;
  private initialCacheCleanupTimeoutId?: number;
  private lastHash?: string;
  private searchDebounceTimeoutId?: number;

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
    this.assignments = new AssignmentHandler(this, this.models, this.selection, this.guard);

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
    const hashChanger = HashChanger.getInstance();
    this.lastHash = hashChanger.getHash();

    router.attachBeforeRouteMatched(() => {
      const pendingHash = hashChanger.getHash();
      const currentHash = this.lastHash ?? pendingHash;
      const i18n = this.getI18nBundle();

      const proceed = (): void => {
        this.lastHash = pendingHash;
        hashChanger.setHash(pendingHash);
      };

      if (!this.guard.checkNavigation(i18n, proceed)) {
        hashChanger.setHash(currentHash);
      } else {
        this.lastHash = pendingHash;
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

    const clientsRoute = router.getRoute("clients");
    if (clientsRoute) {
      clientsRoute.attachPatternMatched(this.onClientsRouteMatched.bind(this));
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

  private setSelectedTab(key: string): void {
    const viewModel = this.models.getViewStateModel();
    viewModel.setProperty("/selectedTabKey", key);
  }

  /**
   * Handle employees route matched - bind page to client context
   */
  private onEmployeesRouteMatched(event: Event): void {
    const args = event.getParameter("arguments") as { clientId: string };
    const clientId = args?.clientId;

    if (!clientId) {
      Log.error("No clientId in route parameters", undefined, "hr.admin.Main");
      return;
    }

    this.setSelectedTab("employees");

    const view = this.getView();
    if (!view) {
      return;
    }

    const model = view.getModel() as ODataModel;
    if (!model) {
      Log.error("OData model not found", undefined, "hr.admin.Main");
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

    // Create context for selection state using model.bindContext
    // This returns a context immediately, even before data is loaded
    const contextBinding = model.bindContext(clientPath);

    // Wait for context to be ready before updating selection state
    // This is critical for deep links and page refresh scenarios
    contextBinding.attachEventOnce("dataReceived", () => {
      const context = contextBinding.getBoundContext();
      if (context) {
        this.selection.setClient(context);
        this.selection.clearEmployee();
        this.selection.clearCostCenter();
        this.selection.clearLocation();
      }
    });

    // Navigate to employees page in the App NavContainer
    const app = this.byId("app") as any;
    if (app && employeesPage) {
      app.to(employeesPage.getId());
    }
  }

  /**
   * Handle cost centers route matched - bind page to client context
   */
  private onCostCentersRouteMatched(event: Event): void {
    const args = event.getParameter("arguments") as { clientId: string };
    const clientId = args?.clientId;

    if (!clientId) {
      Log.error("No clientId in route parameters", undefined, "hr.admin.Main");
      return;
    }

    this.setSelectedTab("costCenters");

    const view = this.getView();
    if (!view) {
      return;
    }

    const model = view.getModel() as ODataModel;
    if (!model) {
      Log.error("OData model not found", undefined, "hr.admin.Main");
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

    // Create context for selection state using model.bindContext
    // This returns a context immediately, even before data is loaded
    const contextBinding = model.bindContext(clientPath);

    // Wait for context to be ready before updating selection state
    // This is critical for deep links and page refresh scenarios
    contextBinding.attachEventOnce("dataReceived", () => {
      const context = contextBinding.getBoundContext();
      if (context) {
        this.selection.setClient(context);
        this.selection.clearEmployee();
        this.selection.clearCostCenter();
        this.selection.clearLocation();
      }
    });

    // Navigate to cost centers page in the App NavContainer
    const app = this.byId("app") as any;
    if (app && costCentersPage) {
      app.to(costCentersPage.getId());
    }
  }

  /**
   * Handle locations route matched - bind page to client context
   */
  private onLocationsRouteMatched(event: Event): void {
    const args = event.getParameter("arguments") as { clientId: string };
    const clientId = args?.clientId;

    if (!clientId) {
      Log.error("No clientId in route parameters", undefined, "hr.admin.Main");
      return;
    }

    this.setSelectedTab("locations");

    const view = this.getView();
    if (!view) {
      return;
    }

    const model = view.getModel() as ODataModel;
    if (!model) {
      Log.error("OData model not found", undefined, "hr.admin.Main");
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

    // Create context for selection state using model.bindContext
    // This returns a context immediately, even before data is loaded
    const contextBinding = model.bindContext(clientPath);

    // Wait for context to be ready before updating selection state
    // This is critical for deep links and page refresh scenarios
    contextBinding.attachEventOnce("dataReceived", () => {
      const context = contextBinding.getBoundContext();
      if (context) {
        this.selection.setClient(context);
        this.selection.clearEmployee();
        this.selection.clearCostCenter();
        this.selection.clearLocation();
      }
    });

    // Navigate to locations page in the App NavContainer
    const app = this.byId("app") as any;
    if (app && locationsPage) {
      app.to(locationsPage.getId());
    }
  }

  /**
   * Handle clients route matched - navigate back to main page
   */
  private onClientsRouteMatched(): void {
    this.setSelectedTab("clients");
    // Navigate back to clients page in the App NavContainer
    const app = this.byId("app") as any;
    const mainPage = this.byId("mainPage");
    if (app && mainPage) {
      app.to(mainPage.getId());
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
      Log.error("Authorization model not found", undefined, "hr.admin.Main");
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
      Log.error("Failed to load authorization info", error instanceof Error ? error.message : String(error), "hr.admin.Main");
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
    this.cacheCleanupIntervalId = setInterval(() => {
      this.cacheManager.clearExpired();
    }, cleanupInterval) as unknown as number;

    // Run initial cleanup after 1 minute
    this.initialCacheCleanupTimeoutId = setTimeout(() => {
      this.cacheManager.clearExpired();
    }, 60000) as unknown as number;
  }

  /**
   * Cleanup lifecycle method - called when controller is destroyed
   * Prevents memory leaks by destroying all service instances and models
   */
  public onExit(): void {
    // Clear timers to prevent memory leaks
    if (this.cacheCleanupIntervalId !== undefined) {
      clearInterval(this.cacheCleanupIntervalId);
      this.cacheCleanupIntervalId = undefined;
    }
    if (this.initialCacheCleanupTimeoutId !== undefined) {
      clearTimeout(this.initialCacheCleanupTimeoutId);
      this.initialCacheCleanupTimeoutId = undefined;
    }
    if (this.searchDebounceTimeoutId !== undefined) {
      clearTimeout(this.searchDebounceTimeoutId);
      this.searchDebounceTimeoutId = undefined;
    }

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
    if (this.assignments && typeof (this.assignments as any).destroy === 'function') {
      (this.assignments as any).destroy();
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
    this.confirmNavigation(() => this.clients.handleClientPress(event));
  }

  public onTabSelect(event: Event): void {
    const key = event.getParameter("key") as string;
    this.navigateToTab(key);
  }

  private navigateToTab(key: string): void {
    const i18n = this.getI18nBundle();
    const proceed = (): void => {
      const router = this.getOwnerComponent()?.getRouter();
      if (!router) {
        return;
      }

      switch (key) {
        case "clients":
          router.navTo("clients");
          break;
        case "employees":
          if (this.selection.ensureClientSelected()) {
            router.navTo("employees", { clientId: this.selection.getSelectedClientId() });
          } else {
            this.setSelectedTab("clients");
            router.navTo("clients");
          }
          break;
        case "costCenters":
          if (this.selection.ensureClientSelected()) {
            router.navTo("costCenters", { clientId: this.selection.getSelectedClientId() });
          } else {
            this.setSelectedTab("clients");
            router.navTo("clients");
          }
          break;
        case "locations":
          if (this.selection.ensureClientSelected()) {
            router.navTo("locations", { clientId: this.selection.getSelectedClientId() });
          } else {
            this.setSelectedTab("clients");
            router.navTo("clients");
          }
          break;
        default:
          router.navTo("clients");
      }
    };

    if (this.guard.checkNavigation(i18n, proceed)) {
      proceed();
    }
  }

  public onBackToClients(): void {
    this.confirmNavigation(() => this.navigation.backToClients());
  }

  public onRefreshEmployees(): void {
    // Clear employee entity cache and refresh list
    this.cacheManager.clearEntity('Employees');
    // Clear search field
    const searchField = this.byId("employeeSearchField") as SearchField;
    if (searchField) {
      searchField.setValue("");
    }
    // Clear any filters on the employees list
    const employeesList = this.byId("employeesList") as List;
    if (employeesList) {
      const binding = employeesList.getBinding("items") as ODataListBinding;
      if (binding) {
        binding.filter([]);
      }
    }
    this.employees.refresh();
  }

  /**
   * Handle employee search - triggered on search submit (Enter key)
   */
  public onEmployeeSearch(event: Event): void {
    const query = event.getParameter("query") as string;
    this.filterEmployees(query);
  }

  /**
   * Handle employee search live change - triggered as user types
   * Uses debouncing to avoid excessive OData requests
   */
  public onEmployeeSearchLiveChange(event: Event): void {
    const query = event.getParameter("newValue") as string;
    
    // Clear any pending debounce timeout
    if (this.searchDebounceTimeoutId !== undefined) {
      clearTimeout(this.searchDebounceTimeoutId);
    }
    
    // Debounce search to avoid excessive requests (300ms delay)
    this.searchDebounceTimeoutId = setTimeout(() => {
      this.filterEmployees(query);
      this.searchDebounceTimeoutId = undefined;
    }, 300) as unknown as number;
  }

  /**
   * Apply filter to employees list based on search query.
   * Filters by firstName, lastName, email, and employeeId.
   * Note: OData V4 Contains filter is case-insensitive by default.
   */
  private filterEmployees(query: string): void {
    const employeesList = this.byId("employeesList") as List;
    if (!employeesList) {
      return;
    }

    const binding = employeesList.getBinding("items") as ODataListBinding;
    if (!binding) {
      return;
    }

    if (!query || query.trim().length === 0) {
      // Clear filters when search is empty
      binding.filter([]);
      return;
    }

    const searchValue = query.trim().toLowerCase();

    // Create filters for each searchable field using OData contains/tolower
    // For OData V4, we use FilterOperator.Contains for case-insensitive search
    const filters = [
      new Filter("firstName", FilterOperator.Contains, searchValue),
      new Filter("lastName", FilterOperator.Contains, searchValue),
      new Filter("email", FilterOperator.Contains, searchValue),
      new Filter("employeeId", FilterOperator.Contains, searchValue),
    ];

    // Combine with OR logic - match any of the fields
    const combinedFilter = new Filter({
      filters: filters,
      and: false,
    });

    binding.filter([combinedFilter]);
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
      this.navigateToTab("costCenters");
    }
  }

  public onBackToEmployees(): void {
    this.confirmNavigation(() => this.navigation.backToEmployees());
  }

  public onRefreshCostCenters(): void {
    // Clear cost center entity cache and refresh list
    this.cacheManager.clearEntity('CostCenters');
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
      this.navigateToTab("locations");
    }
  }

  public onRefreshLocations(): void {
    // Clear location entity cache and refresh list
    this.cacheManager.clearEntity('Locations');
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

  public onRefreshAssignments(): void {
    this.assignments.refresh();
  }

  public onAddAssignment(): void {
    this.assignments.startCreate();
  }

  public onEditAssignment(): Promise<void> {
    return this.assignments.startEdit();
  }

  public onDeleteAssignment(): void {
    this.assignments.delete();
  }

  public onSaveAssignment(): void {
    this.assignments.save();
  }

  public onCancelAssignment(): void {
    this.assignments.cancel();
  }

  public onAssignmentDialogAfterClose(): void {
    this.assignments.afterDialogClose();
  }

  public onAssignmentsSelectionChange(event: Event): void {
    this.assignments.handleSelectionChange(event);
  }

  public onOpenAnonymizeDialog(): void {
    const dialog = this.byId("anonymizeDialog") as Dialog;
    const viewModel = this.models.getViewStateModel();
    const today = new Date();
    viewModel.setProperty("/anonymizeBefore", today.toISOString().slice(0, 10));
    dialog.open();
  }

  public onConfirmAnonymize(): void {
    const view = this.getView();
    const i18n = this.getI18nBundle();
    const dialog = this.byId("anonymizeDialog") as Dialog;
    const model = view?.getModel() as ODataModel;
    const viewModel = this.models.getViewStateModel();
    const before = viewModel.getProperty("/anonymizeBefore") as string;

    if (!before) {
      MessageBox.error(i18n.getText("anonymizeDateRequired"));
      return;
    }

    dialog.setBusy(true);
    const action = model.bindContext("/anonymizeFormerEmployees(...)");
    action.setParameter("before", before);
    action
      .execute()
      .then(() => {
        const context = action.getBoundContext();
        const result = context?.getObject() as number | { value?: number } | undefined;
        const affected = typeof result === "number" ? result : result?.value ?? 0;
        MessageToast.show(i18n.getText("anonymizeSuccess", [affected]));
        dialog.setBusy(false);
        dialog.close();
      })
      .catch((error: Error) => {
        dialog.setBusy(false);
        MessageBox.error(error.message ?? i18n.getText("anonymizeFailed"));
      });
  }

  public onCancelAnonymize(): void {
    const dialog = this.byId("anonymizeDialog") as Dialog;
    dialog.close();
  }

  private confirmNavigation(action: () => void): void {
    const i18n = this.getI18nBundle();
    if (this.guard.checkNavigation(i18n, action)) {
      action();
    }
  }
}
