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
        country_code: currentData.country_code ?? null,
      },
    });
    this.openDialog();
  }

  public delete(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const context = this.selection.getSelectedClientContext() as Context;
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
              MessageBox.error(error.message ?? "Failed to delete client");
            });
        }
      },
    });
  }

  public save(): void {
    const dialog = this.byId("clientDialog") as Dialog;
    const dialogModel = this.models.getClientModel();
    const data = dialogModel.getData();
    const isCreateMode = data.mode === "create" || !data.client.ID;
    const countryCode = data.client.country_code?.trim() ?? "";
    const payload = {
      companyId: data.client.companyId?.trim() ?? "",
      name: data.client.name?.trim() ?? "",
      country_code: countryCode ? countryCode.toUpperCase() : null,
    };

    if (!payload.companyId || !payload.name) {
      MessageBox.error("Company ID and Name are required.");
      return;
    }

    if (isCreateMode && !payload.country_code) {
      MessageBox.error("Country is required.");
      return;
    }

    dialog.setBusy(true);

    if (data.mode === "create") {
      const creationContext = this.getClientsBinding().create(payload) as Context | undefined;
      this.runWithCreationContext(
        creationContext,
        (error?: unknown) => {
          dialog.setBusy(false);
          const errorMessage =
            error instanceof Error && error.message
              ? error.message
              : "Failed to initialize client creation context.";
          MessageBox.error(errorMessage);
        },
        (context) => {
          const readyContext = context as CreationContext;
          const creationPromise = readyContext.created?.();

          if (!creationPromise) {
            dialog.setBusy(false);
            dialog.close();
            MessageToast.show("Client created");
            return;
          }

          creationPromise
            .then(() => {
              dialog.setBusy(false);
              dialog.close();
              MessageToast.show("Client created");
            })
            .catch((error: Error) => {
              dialog.setBusy(false);
              MessageBox.error(error.message ?? "Failed to create client");
              readyContext.delete("$auto");
            });
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
      context.setProperty("country_code", payload.country_code ?? null);
      model
        .submitBatch("$auto")
        .then(() => {
          dialog.setBusy(false);
          dialog.close();
          MessageToast.show("Client updated");
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          model.resetChanges();
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
    context: Context | PromiseLike<Context> | undefined,
    onMissing: (error?: unknown) => void,
    onReady: (context: CreationContext) => void
  ): void {
    if (!context) {
      onMissing();
      return;
    }

    const candidate = context as Context;
    if (typeof candidate.getModel === "function") {
      onReady(candidate as CreationContext);
      return;
    }

    const maybePromise = context as PromiseLike<Context>;
    if (typeof maybePromise.then === "function") {
      maybePromise
        .then((resolvedContext) => {
          if (!resolvedContext) {
            onMissing();
            return;
          }

          onReady(resolvedContext as CreationContext);
        })
        .catch((error: unknown) => {
          onMissing(error);
        });
      return;
    }

    onMissing();
  }
}
