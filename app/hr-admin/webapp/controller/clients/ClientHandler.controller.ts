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
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import Log from "sap/base/Log";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import { ClientDialogModelData } from "../../types/DialogTypes";
import { getRequiredListBinding } from "../../core/services/odata";
import NavigationService from "../../core/navigation/NavigationService";
import { getEventParameter } from "../../core/utils/EventParam";
import { createAbortableRequest } from "../../core/utils/AbortableRequest";
import UnsavedChangesGuard from "../../core/guards/UnsavedChangesGuard";
import { fetchClientDeletePreview, buildDeleteSummary } from "../../services/deletePreview.service";

type ODataContext = NonNullable<Context>;
type CreationContext = {
  created(): Promise<void> | undefined;
  delete(groupId?: string): Promise<void>;
};


export default class ClientHandler {
  private static readonly DIALOG_ID = "clientDialog";

  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor,
    private readonly selection: SelectionState,
    private readonly navigation: NavigationService,
    private readonly guard: UnsavedChangesGuard
  ) {}

  private getI18nBundle(): ResourceBundle {
    const view = this.controller.getView();
    const model = view?.getModel("i18n") as ResourceModel;
    return model.getResourceBundle() as ResourceBundle;
  }

  public refresh(): void {
    this.getClientsBinding().refresh();
  }

  public startCreate(): void {
    const i18n = this.getI18nBundle();
    const dialogModel = this.models.getClientModel();
    dialogModel.setData({
      mode: "create",
      title: i18n.getText("addClient"),
      client: {
        companyId: "",
        name: "",
      },
    });
    this.guard.markDirty(ClientHandler.DIALOG_ID);
    this.openDialog();
  }

  public startEdit(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedClientContext();
    const dialogModel = this.models.getClientModel();
    const currentData = context?.getObject() as ClientDialogModelData["client"] | undefined;

    if (!currentData) {
      MessageBox.error(i18n.getText("errorLoading", ["client"]));
      return;
    }

    dialogModel.setData({
      mode: "edit",
      title: i18n.getText("editClient"),
      client: {
        ID: currentData.ID,
        companyId: currentData.companyId,
        name: currentData.name,
      },
    });
    this.guard.markDirty(ClientHandler.DIALOG_ID);
    this.openDialog();
  }

  public delete(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedClientContext();
    if (!context) {
      MessageBox.error(i18n.getText("noClientSelected"));
      return;
    }
    const client = context.getObject() as { ID?: string; name?: string };
    const clientId = client.ID;
    const clientName = client.name ?? "";

    if (!clientId) {
      MessageBox.error(i18n.getText("noClientSelected"));
      return;
    }

    // Fetch delete preview to show impact
    const view = this.controller.getView();
    if (view) {
      view.setBusy(true);
    }

    fetchClientDeletePreview(clientId)
      .then((preview) => {
        if (view) {
          view.setBusy(false);
        }

        const summary = buildDeleteSummary(preview);
        let confirmMessage = i18n.getText("deleteClientConfirm") + ` ${clientName}?`;

        if (summary) {
          confirmMessage += `\n\n${i18n.getText("deleteClientWarning")}\n${summary}`;
        }

        MessageBox.confirm(confirmMessage, {
          title: i18n.getText("confirm"),
          emphasizedAction: MessageBox.Action.OK,
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          onClose: (action: string) => {
            if (action === MessageBox.Action.OK) {
              context
                .delete("$auto")
                .then(() => {
                  MessageToast.show(i18n.getText("clientDeleted"));
                  this.selection.clearClient();
                })
                .catch((error: Error) => {
                  console.error("Error deleting client:", error);
                  MessageBox.error(error.message ?? i18n.getText("errorDeleting", ["client"]));
                });
            }
          },
        });
      })
      .catch((error) => {
        if (view) {
          view.setBusy(false);
        }
        Log.warning("Failed to fetch delete preview, proceeding with basic confirmation", error instanceof Error ? error.message : String(error), "hr.admin.ClientHandler");

        // Fall back to basic confirmation if preview fails
        MessageBox.confirm(i18n.getText("deleteClientConfirm") + ` ${clientName}?`, {
          title: i18n.getText("confirm"),
          emphasizedAction: MessageBox.Action.OK,
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          onClose: (action: string) => {
            if (action === MessageBox.Action.OK) {
              context
                .delete("$auto")
                .then(() => {
                  MessageToast.show(i18n.getText("clientDeleted"));
                  this.selection.clearClient();
                })
                .catch((deleteError: Error) => {
                  Log.error("Error deleting client", deleteError.message, "hr.admin.ClientHandler");
                  MessageBox.error(deleteError.message ?? i18n.getText("errorDeleting", ["client"]));
                });
            }
          },
        });
      });
  }

  public save(): void {
    const i18n = this.getI18nBundle();
    const dialog = this.byId("clientDialog") as Dialog;
    if (!dialog) {
      MessageBox.error(i18n.getText("errorOccurred"));
      return;
    }
    const dialogModel = this.models.getClientModel();
    const data = dialogModel.getData();

    const payload = {
      companyId: data.client.companyId?.trim() ?? "",
      name: data.client.name?.trim() ?? "",
    };

    // Enhanced validation
    if (!payload.companyId || !payload.name) {
      MessageBox.error(i18n.getText("clientIdRequired"));
      return;
    }

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getClientsBinding();
      let creationContext: Context | undefined;
      try {
        creationContext = listBinding.create(payload) as Context | undefined;
      } catch (error) {
        console.error("Failed to start client creation:", error);
        dialog.setBusy(false);

        const message =
          error instanceof Error
            ? error.message
            : i18n.getText("errorSaving", ["client"]);
        MessageBox.error(message);
        return;
      }
      this.runWithCreationContext(
        creationContext,
        () => {
          dialog.setBusy(false);
          MessageBox.error(i18n.getText("errorOccurred"));
        },
        (context) => {
          const readyContext = context as CreationContext & ODataContext;
          const model = readyContext.getModel() as ODataModel;

          const handleError = (error: unknown): void => {
            console.error("Error creating client:", error);
            dialog.setBusy(false);

            let message = i18n.getText("errorSaving", ["client"]);
            
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
              this.guard.markClean(ClientHandler.DIALOG_ID);
              MessageToast.show(i18n.getText("clientSaved"));
              // Refresh the list to ensure any backend-normalized data is displayed consistently
              this.getClientsBinding().refresh();
            })
            .catch(handleError)
            .finally(() => cleanup());
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedClientContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("selectClientFirst"));
        return;
      }

      const model = context.getModel() as ODataModel;
      context.setProperty("companyId", payload.companyId);
      context.setProperty("name", payload.name);

      // Add timeout for update as well
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(i18n.getText("errorOccurred")));
        }, 30000);
      });

      Promise.race([
        model.submitBatch("$auto"),
        timeoutPromise
      ])
        .then(() => {
          dialog.setBusy(false);
          dialog.close();
          this.guard.markClean(ClientHandler.DIALOG_ID);
          MessageToast.show(i18n.getText("clientSaved"));
          // Refresh the list to pick up backend-normalized values (e.g., companyId casing)
          // and ensure related bindings like cost centers reflect the latest client data.
          this.getClientsBinding().refresh();
        })
        .catch((error: Error) => {
          console.error("Error updating client:", error);
          dialog.setBusy(false);
          MessageBox.error(error.message ?? i18n.getText("errorSaving", ["client"]));
        });
    }
  }

  public cancel(): void {
    const dialog = this.byId("clientDialog") as Dialog;
    this.guard.markClean(ClientHandler.DIALOG_ID);
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("clientDialog") as Dialog;
    dialog.setBusy(false);
    // Clear unsaved changes guard in case dialog was closed via ESC or X button
    this.guard.markClean(ClientHandler.DIALOG_ID);
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