import App from "sap/m/App";
import MessageBox from "sap/m/MessageBox";
import Page from "sap/m/Page";
import Controller from "sap/ui/core/mvc/Controller";
import Context from "sap/ui/model/odata/v4/Context";

import SelectionState from "../../services/selection.service";

export default class NavigationService {
  constructor(
    private readonly controller: Controller,
    private readonly selection: SelectionState
  ) {}

  public showEmployeesPage(context: Context): void {
    const app = this.controller.byId("app") as App | undefined;
    const employeesPage = this.controller.byId("employeesPage") as Page | undefined;
    const costCentersPage = this.controller.byId("costCentersPage") as Page | undefined;
    const locationsPage = this.controller.byId("locationsPage") as Page | undefined;
    if (!app || !employeesPage) {
      MessageBox.error("Unable to open employees view.");
      return;
    }

    employeesPage.setBindingContext(context);
    costCentersPage?.setBindingContext(context);
    locationsPage?.setBindingContext(context);
    this.selection.clearEmployee();
    this.selection.clearCostCenter();
    this.selection.clearLocation();
    app.to(employeesPage);
  }

  public showCostCentersPage(): void {
    const app = this.controller.byId("app") as App | undefined;
    const costCentersPage = this.controller.byId("costCentersPage") as Page | undefined;
    const clientContext = this.selection.getSelectedClientContext();

    if (!app || !costCentersPage || !clientContext) {
      MessageBox.error("Unable to open cost centers view.");
      return;
    }

    costCentersPage.setBindingContext(clientContext);
    this.selection.clearCostCenter();
    app.to(costCentersPage);
  }

  public showLocationsPage(): void {
    const app = this.controller.byId("app") as App | undefined;
    const locationsPage = this.controller.byId("locationsPage") as Page | undefined;
    const clientContext = this.selection.getSelectedClientContext();

    if (!app || !locationsPage || !clientContext) {
      MessageBox.error("Unable to open locations view.");
      return;
    }

    locationsPage.setBindingContext(clientContext);
    this.selection.clearLocation();
    app.to(locationsPage);
  }

  public backToClients(): void {
    const app = this.controller.byId("app") as App | undefined;
    if (!app) {
      return;
    }

    this.selection.clearEmployee();
    this.selection.clearCostCenter();
    this.selection.clearLocation();
    app.back();
  }

  public backToEmployees(): void {
    const app = this.controller.byId("app") as App | undefined;
    if (!app) {
      return;
    }

    this.selection.clearCostCenter();
    this.selection.clearLocation();
    app.back();
  }
}
