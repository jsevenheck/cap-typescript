import UIComponent from "sap/ui/core/UIComponent";
import MessageBox from "sap/m/MessageBox";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Log from "sap/base/Log";

/**
 * Extended UIComponent interface with handler property for lifecycle management.
 */
interface HRAdminComponent extends UIComponent {
  _fnUnhandledRejectionHandler: ((event: PromiseRejectionEvent) => void) | null;
}

/**
 * Component for the HR Admin application.
 * 
 * Implements proper lifecycle management for global event handlers
 * to prevent memory leaks when the component is destroyed and recreated.
 */
export default UIComponent.extend("hr.admin.Component", {
  metadata: {
    manifest: "json",
  },

  /**
   * Bound handler for unhandled promise rejections.
   * Stored as instance property to allow proper cleanup in exit().
   */
  _fnUnhandledRejectionHandler: null as ((event: PromiseRejectionEvent) => void) | null,

  init(this: HRAdminComponent): void {
    // Call parent init
    UIComponent.prototype.init.call(this);

    // Initialize the router
    this.getRouter().initialize();

    // Set up global error handler for OData model
    const odataModel = this.getModel();
    if (odataModel) {
      const handleError = (response: any) => {
        if (!response) {
          return;
        }

        // Don't show error for aborted requests (user navigation)
        if (response && response.statusCode === 0) {
          return;
        }

        let errorMessage = "An error occurred while communicating with the server.";

        if (response) {
          if (response.statusCode === 401) {
            errorMessage = "Authentication required. Please log in again.";
          } else if (response.statusCode === 403) {
            errorMessage = "You do not have permission to perform this action.";
          } else if (response.statusCode === 404) {
            errorMessage = "The requested resource was not found.";
          } else if (response.statusCode === 412) {
            errorMessage = "The data has been modified by another user. Please refresh and try again.";
          } else if (response.statusCode >= 500) {
            errorMessage = "A server error occurred. Please try again later.";
          } else if (response.body) {
            try {
              const errorBody = JSON.parse(response.body);
              if (errorBody.error && errorBody.error.message) {
                errorMessage = errorBody.error.message;
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }

        MessageBox.error(errorMessage, {
          title: "Error",
          actions: [MessageBox.Action.CLOSE],
        });
      };

      // Attach to request failure events supported by the active model
      const attachRequestFailed = (model: any) => {
        model.attachRequestFailed((event: any) => {
          const response = event.getParameter?.("response") ?? event.getParameters()?.response;
          handleError(response);
        });
      };

      // The v4 ODataModel does not support requestFailed; avoid attaching to prevent runtime errors
      if (odataModel instanceof ODataModel) {
        Log.info("Skipping requestFailed handler for v4 ODataModel (event unsupported)");
      } else if ((odataModel as any).attachRequestFailed) {
        attachRequestFailed(odataModel);
      }
    }

    // Create bound handler for unhandled promise rejections
    // Store reference for cleanup in exit()
    this._fnUnhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);

      // Prevent default browser error handling
      event.preventDefault();

      // Only show user-facing error for non-trivial errors
      if (event.reason && event.reason instanceof Error) {
        const message = event.reason.message || 'An unexpected error occurred';
        MessageBox.error(message, {
          title: "Unexpected Error",
          actions: [MessageBox.Action.CLOSE],
        });
      }
    };

    window.addEventListener('unhandledrejection', this._fnUnhandledRejectionHandler);
  },

  /**
   * Cleanup lifecycle hook.
   * Removes global event listeners to prevent memory leaks.
   */
  exit(this: HRAdminComponent): void {
    // Remove global event listener to prevent memory leaks
    if (this._fnUnhandledRejectionHandler) {
      window.removeEventListener('unhandledrejection', this._fnUnhandledRejectionHandler);
      this._fnUnhandledRejectionHandler = null;
    }
  },
});
