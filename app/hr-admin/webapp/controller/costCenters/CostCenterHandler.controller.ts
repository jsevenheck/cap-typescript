import Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import ListItemBase from "sap/m/ListItemBase";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import { getOptionalListBinding } from "../../core/services/odata";
import { getEventParameter } from "../../core/utils/EventParam";

type ODataContext = NonNullable<Context>;
type CreationContext = {
  created(): Promise<void> | undefined;
  delete(groupId?: string): Promise<void>;
};

export default class CostCenterHandler {
  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor,
    private readonly selection: SelectionState
  ) {}

  public refresh(): void {
    this.getCostCentersBinding()?.refresh();
  }

  public startCreate(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const dialogModel = this.models.getCostCenterModel();
    dialogModel.setData({
      mode: "create",
      title: "Add Cost Center",
      costCenter: {
        code: "",
        name: "",
        description: "",
        responsible_ID: undefined,
      },
    });
    this.openDialog();
  }

  public async startEdit(): Promise<void> {
    if (!this.selection.ensureCostCenterSelected()) {
      return;
    }

    const context = this.selection.getSelectedCostCenterContext() as Context;
    const view = this.controller.getView();
    if (!view) {
      return;
    }

    view.setBusy(true);

    try {
      const currentData = (await context.requestObject()) as {
        ID?: string;
        code?: string;
        name?: string;
        description?: string;
        responsible_ID?: string;
        responsible?: { ID?: string };
      } | undefined;
      if (!currentData) {
        MessageBox.error("Unable to load the selected cost center.");
        return;
      }

      const dialogModel = this.models.getCostCenterModel();
      dialogModel.setData({
        mode: "edit",
        title: "Edit Cost Center",
        costCenter: {
          ID: currentData.ID,
          code: currentData.code ?? "",
          name: currentData.name ?? "",
          description: currentData.description ?? "",
          responsible_ID: currentData.responsible_ID ?? currentData.responsible?.ID,
        },
      });
      this.openDialog();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load the selected cost center.";
      MessageBox.error(message);
    } finally {
      view.setBusy(false);
    }
  }

  public delete(): void {
    if (!this.selection.ensureCostCenterSelected()) {
      return;
    }

    const context = this.selection.getSelectedCostCenterContext() as Context;
    const costCenter = context.getObject() as { code?: string; name?: string };
    const title = costCenter.code
      ? `${costCenter.code}${costCenter.name ? " - " + costCenter.name : ""}`
      : costCenter.name ?? "";
    MessageBox.confirm(`Delete cost center ${title}?`, {
      title: "Confirm Deletion",
      emphasizedAction: MessageBox.Action.OK,
      actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
      onClose: (action: string) => {
        if (action === MessageBox.Action.OK) {
          context
            .delete("$auto")
            .then(() => {
              MessageToast.show("Cost center deleted");
              this.selection.clearCostCenter();
            })
            .catch((error: Error) => {
              MessageBox.error(error.message ?? "Failed to delete cost center");
            });
        }
      },
    });
  }

  public save(): void {
    const dialog = this.byId("costCenterDialog") as Dialog;
    const dialogModel = this.models.getCostCenterModel();
    const data = dialogModel.getData();
    const clientId = this.selection.getSelectedClientId();

    const payload: Record<string, unknown> = {
      code: data.costCenter.code?.trim() ?? "",
      name: data.costCenter.name?.trim() ?? "",
      description: data.costCenter.description?.trim() ?? "",
      responsible_ID: data.costCenter.responsible_ID,
    };

    if (!payload.code || !payload.name || !payload.responsible_ID) {
      MessageBox.error("Code, Name, and Responsible are required.");
      return;
    }

    if (!clientId) {
      MessageBox.error("Select a client first.");
      return;
    }

    payload.client_ID = clientId;

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getCostCentersBinding();
      if (!listBinding) {
        dialog.setBusy(false);
        MessageBox.error("Unable to access cost centers list.");
        return;
      }

      const creationContext = listBinding.create(payload) as Context | undefined;
      const model = listBinding.getModel() as ODataModel;
      void model
        .submitBatch("$auto")
        .catch(() => undefined);
      this.runWithCreationContext(
        creationContext,
        () => {
          dialog.setBusy(false);
          MessageBox.error("Failed to initialize cost center creation context.");
        },
        (context) => {
          const readyContext = context as CreationContext;
          const creationPromise = readyContext.created?.();

          if (!creationPromise) {
            dialog.setBusy(false);
            dialog.close();
            MessageToast.show("Cost center created");
            return;
          }

          creationPromise
            .then(() => {
              dialog.setBusy(false);
              dialog.close();
              MessageToast.show("Cost center created");
            })
            .catch((error: Error) => {
              dialog.setBusy(false);
              MessageBox.error(error.message ?? "Failed to create cost center");
              readyContext.delete();
            });
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedCostCenterContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error("Select a cost center first.");
        return;
      }

      const model = context.getModel() as ODataModel;
      context.setProperty("code", payload.code);
      context.setProperty("name", payload.name);
      context.setProperty("description", payload.description);
      context.setProperty("responsible_ID", payload.responsible_ID);
      model
        .submitBatch("$auto")
        .then(() => {
          dialog.setBusy(false);
          dialog.close();
          MessageToast.show("Cost center updated");
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          model.resetChanges();
          MessageBox.error(error.message ?? "Failed to update cost center");
        });
    }
  }

  public cancel(): void {
    const dialog = this.byId("costCenterDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("costCenterDialog") as Dialog;
    dialog.setBusy(false);
  }

  public handleSelectionChange(event: Event): void {
    const listItem = getEventParameter<ListItemBase | null>(event, "listItem") ?? null;
    const context = listItem ? (listItem.getBindingContext() as Context) : undefined;
    this.selection.setCostCenter(context || undefined);
  }

  private getCostCentersBinding(): ODataListBinding | undefined {
    return getOptionalListBinding(this.controller, "costCentersList");
  }

  private openDialog(): void {
    const dialog = this.byId("costCenterDialog") as Dialog;
    dialog.setBusy(false);
    const clientContext = this.selection.getSelectedClientContext();
    if (clientContext) {
      dialog.setBindingContext(clientContext);
    }
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
