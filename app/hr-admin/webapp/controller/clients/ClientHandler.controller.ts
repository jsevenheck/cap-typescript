import Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import List from "sap/m/List";
import ListItemBase from "sap/m/ListItemBase";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import Context from "sap/ui/model/odata/v4/Context";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import { ClientDialogModelData } from "../../types/DialogTypes";
import { getRequiredListBinding } from "../../core/services/odata";
import NavigationService from "../../core/navigation/NavigationService";
import { getEventParameter } from "../../core/utils/EventParam";
import { createAbortableRequest } from "../../core/utils/AbortableRequest";

type ODataContext = NonNullable<Context>;
type CreationContext = {
  created(): Promise<void> | undefined;
  delete(groupId?: string): Promise<void>;
};

export default class ClientHandler {
  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor,
    private readonly selection: SelectionState,
    private readonly navigation: NavigationService
  ) {}

  public refresh(): void {
    this.getClientsBinding().refresh();
  }

  public startCreate(): void {
    const dialogModel = this.models.getClientModel();
    dialogModel.setData({
      mode: "create",
      title: "Add Client",
      client: {
        companyId: "",
        name: "",
        notificationEndpoint: "",
        country_code: "",
      },
    });
    this.openDialog();
  }

  public startEdit(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const context = this.selection.getSelectedClientContext();
    const dialogModel = this.models.getClientModel();
    const currentData = context?.getObject() as (ClientDialogModelData["client"] & {
      notificationEndpoint?: string | null;
      country_code?: string | null;
    }) | undefined;

    if (!currentData) {
      MessageBox.error("Unable to load the selected client.");
      return;
    }

    dialogModel.setData({
      mode: "edit",
      title: "Edit Client",
        client: {
          ID: currentData.ID,
          companyId: currentData.companyId,
          name: currentData.name,
          notificationEndpoint: currentData.notificationEndpoint ?? null,
          country_code: currentData.country_code ?? null,
        },
      });
    this.openDialog();
  }

  public delete(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const context = this.selection.getSelectedClientContext();
    if (!context) {
      MessageBox.error("No client selected");
      return;
    }
    const client = context.getObject() as { name?: string };
    MessageBox.confirm(`Delete client ${client.name ?? ""}?`, {
      title: "Confirm Deletion",
      emphasizedAction: MessageBox.Action.OK,
      actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
      onClose: (action: string) => {
        if (action === MessageBox.Action.OK) {
          context
            .delete("$auto")
            .then(() => {
              MessageToast.show("Client deleted");
              this.selection.clearClient();
            })
            .catch((error: Error) => {
              console.error("Error deleting client:", error);
              MessageBox.error(error.message ?? "Failed to delete client");
            });
        }
      },
    });
  }

  public save(): void {
    const dialog = this.byId("clientDialog") as Dialog;
    if (!dialog) {
      MessageBox.error("Dialog not found");
      return;
    }
    const dialogModel = this.models.getClientModel();
    const data = dialogModel.getData();
    
    // Extract country code from various formats
    let countryCode = data.client.country_code?.trim() ?? "";
    const notificationEndpoint = data.client.notificationEndpoint?.trim() ?? "";
    
    // If format is "Country Name (XX)", extract the code
    const codeMatch = countryCode.match(/\(([A-Z]{2})\)$/i);
    if (codeMatch) {
      countryCode = codeMatch[1];
    }
    
    const payload = {
      companyId: data.client.companyId?.trim() ?? "",
      name: data.client.name?.trim() ?? "",
      notificationEndpoint: notificationEndpoint || null,
      country_code: countryCode ? countryCode.toUpperCase() : null,
    };

    // Enhanced validation
    if (!payload.companyId || !payload.name) {
      MessageBox.error("Company ID and Name are required.");
      return;
    }

    if (!payload.country_code) {
      MessageBox.error("Country code is required.");
      return;
    }

    // Validate country code format (must be exactly 2 letters)
    if (!/^[A-Z]{2}$/i.test(payload.country_code)) {
      MessageBox.error(
        "Country code must be exactly 2 letters (e.g., 'BH' for Bahrain, 'US' for United States).\n\n" +
        `You entered: '${payload.country_code}'`
      );
      return;
    }

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getClientsBinding();
      const creationContext = listBinding.create(payload) as Context | undefined;
      this.runWithCreationContext(
        creationContext,
        () => {
          dialog.setBusy(false);
          MessageBox.error("Failed to initialize client creation context.");
        },
        (context) => {
          const readyContext = context as CreationContext & ODataContext;
          const model = readyContext.getModel() as ODataModel;

          const handleError = (error: unknown): void => {
            console.error("Error creating client:", error);
            dialog.setBusy(false);
            
            let message = "Failed to create client";
            
            // Enhanced error message extraction for OData errors
            if (error instanceof Error) {
              message = error.message;
            } else if (error && typeof error === 'object') {
              const odataError = error as any;
              
              // Try to extract the most detailed error message available
              if (odataError.error?.message) {
                message = odataError.error.message;
              } else if (odataError.message) {
                message = odataError.message;
              } else if (odataError.statusText) {
                message = odataError.statusText;
              } else if (odataError.responseText) {
                try {
                  const parsed = JSON.parse(odataError.responseText);
                  message = parsed.error?.message || parsed.message || message;
                } catch (e) {
                  // If parsing fails, use default message
                }
              }
            }
            
            MessageBox.error(message);
            void readyContext.delete("$auto").catch((cleanupError) => {
              console.error("Failed to clean up failed creation context:", cleanupError);
            });
          };

          let creationPromise: Promise<unknown>;

          try {
            creationPromise = readyContext.created?.() ?? Promise.resolve();
          } catch (error) {
            handleError(error);
            return;
          }

          const submitPromise = model.submitBatch("$auto");

          // Use AbortableRequest utility for timeout and cancellation support
          const { promise, cleanup } = createAbortableRequest(
            Promise.all([creationPromise, submitPromise]),
            {
              timeout: 30000,
              onTimeout: () => {
                console.warn("Client creation timed out");
              },
            }
          );

          promise
            .then(() => {
              dialog.setBusy(false);
              dialog.close();
              MessageToast.show("Client created");
            })
            .catch(handleError)
            .finally(() => cleanup());
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedClientContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error("Select a client first.");
        return;
      }

      const model = context.getModel() as ODataModel;
      context.setProperty("companyId", payload.companyId);
      context.setProperty("name", payload.name);
      context.setProperty("notificationEndpoint", payload.notificationEndpoint);
      context.setProperty("country_code", payload.country_code ?? null);
      
      // Add timeout for update as well
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("Update operation timed out after 30 seconds."));
        }, 30000);
      });
      
      Promise.race([
        model.submitBatch("$auto"),
        timeoutPromise
      ])
        .then(() => {
          dialog.setBusy(false);
          dialog.close();
          MessageToast.show("Client updated");
        })
        .catch((error: Error) => {
          console.error("Error updating client:", error);
          dialog.setBusy(false);
          MessageBox.error(error.message ?? "Failed to update client");
        });
    }
  }

  public cancel(): void {
    const dialog = this.byId("clientDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("clientDialog") as Dialog;
    dialog.setBusy(false);
  }

  public handleSelectionChange(event: Event): void {
    if (this.selection.isClearingListSelection("clientsList")) {
      return;
    }

    const listItem = getEventParameter<ListItemBase | null>(event, "listItem") ?? null;
    const context = listItem ? (listItem.getBindingContext() as Context) : undefined;
    this.selection.setClient(context || undefined);
  }

  public handleClientPress(event: Event): void {
    const listItem = getEventParameter<ListItemBase | null>(event, "listItem") ?? null;
    if (!listItem) {
      return;
    }

    const context = listItem.getBindingContext() as Context;
    const list = this.byId("clientsList") as List;
    if (!list) {
      console.error("Client list not found");
      return;
    }
    list.setSelectedItem(listItem, true);
    this.selection.setClient(context);
    this.navigation.showEmployeesPage(context);
  }

  private getClientsBinding(): ODataListBinding {
    return getRequiredListBinding(this.controller, "clientsList");
  }

  private openDialog(): void {
    const dialog = this.byId("clientDialog") as Dialog;
    dialog.setBusy(false);
    dialog.open();
  }

  private byId(id: string): unknown {
    return this.controller.byId(id);
  }

  private runWithCreationContext(
    context: Context | undefined,
    onMissing: () => void,
    onReady: (context: CreationContext) => void
  ): void {
    if (!context) {
      onMissing();
      return;
    }

    onReady(context as CreationContext);
  }
}