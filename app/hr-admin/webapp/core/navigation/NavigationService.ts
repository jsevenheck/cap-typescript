import MessageBox from "sap/m/MessageBox";
import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import Router from "sap/ui/core/routing/Router";
import Context from "sap/ui/model/odata/v4/Context";

import SelectionState from "../../services/selection.service";

export default class NavigationService {
  constructor(
    private readonly controller: Controller,
    private readonly selection: SelectionState
  ) {}

  private getRouter(): Router | undefined {
    const component = this.controller.getOwnerComponent() as UIComponent | undefined;
    return component?.getRouter();
  }

  public showEmployeesPage(context: Context): void {
    const router = this.getRouter();
    if (!router) {
      MessageBox.error("Unable to open employees view.");
      return;
    }

    const clientId = context.getProperty("ID") as string;
    if (!clientId) {
      MessageBox.error("Client ID not found.");
      return;
    }

    this.selection.clearEmployee();
    this.selection.clearCostCenter();
    this.selection.clearLocation();

    router.navTo("employees", { clientId });
  }

  public showCostCentersPage(): void {
    const router = this.getRouter();
    const clientContext = this.selection.getSelectedClientContext();

    if (!router || !clientContext) {
      MessageBox.error("Unable to open cost centers view.");
      return;
    }

    const clientId = clientContext.getProperty("ID") as string;
    if (!clientId) {
      MessageBox.error("Client ID not found.");
      return;
    }

    this.selection.clearCostCenter();
    router.navTo("costCenters", { clientId });
  }

  public showLocationsPage(): void {
    const router = this.getRouter();
    const clientContext = this.selection.getSelectedClientContext();

    if (!router || !clientContext) {
      MessageBox.error("Unable to open locations view.");
      return;
    }

    const clientId = clientContext.getProperty("ID") as string;
    if (!clientId) {
      MessageBox.error("Client ID not found.");
      return;
    }

    this.selection.clearLocation();
    router.navTo("locations", { clientId });
  }

  public backToClients(): void {
    const router = this.getRouter();
    if (!router) {
      return;
    }

    this.selection.clearEmployee();
    this.selection.clearCostCenter();
    this.selection.clearLocation();
    router.navTo("clients");
  }

  public backToEmployees(): void {
    const router = this.getRouter();
    const clientContext = this.selection.getSelectedClientContext();

    if (!router || !clientContext) {
      return;
    }

    const clientId = clientContext.getProperty("ID") as string;
    if (!clientId) {
      return;
    }

    this.selection.clearCostCenter();
    this.selection.clearLocation();
    router.navTo("employees", { clientId });
  }
}
