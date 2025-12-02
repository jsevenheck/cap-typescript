import UIComponent from "sap/ui/core/UIComponent";
import MessageBox from "sap/m/MessageBox";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";

export default UIComponent.extend("hr.admin.Component", {
  metadata: {
    manifest: "json",
  },

  init(this: UIComponent): void {
    // Call parent init
    UIComponent.prototype.init.call(this);

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

      if (odataModel instanceof ODataModel && (odataModel as any).attachRequestFailed) {
        attachRequestFailed(odataModel);
      } else if ((odataModel as any).attachRequestFailed) {
        attachRequestFailed(odataModel);
      }
    }

    // Set up global handler for unhandled promise rejections
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
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
    });
  },
});
