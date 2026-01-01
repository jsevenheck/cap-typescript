import Controller from "sap/ui/core/mvc/Controller";
import History from "sap/ui/core/routing/History";

/**
 * Controller for the NotFound page.
 * Handles navigation back and home link functionality.
 */
export default class NotFound extends Controller {
  /**
   * Handle navigation back button press.
   * Navigates to previous page if available, otherwise goes to home.
   */
  public onNavBack(): void {
    const history = History.getInstance();
    const previousHash = history.getPreviousHash();

    if (previousHash !== undefined) {
      window.history.go(-1);
    } else {
      this.onGoHome();
    }
  }

  /**
   * Navigate to the home page (clients list).
   */
  public onGoHome(): void {
    const router = this.getOwnerComponent()?.getRouter();
    if (router) {
      router.navTo("clients", {}, true);
    }
  }
}
