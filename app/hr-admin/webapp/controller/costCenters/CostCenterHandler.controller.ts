import Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import ListItemBase from "sap/m/ListItemBase";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import UnsavedChangesGuard from "../../core/guards/UnsavedChangesGuard";
import { getOptionalListBinding } from "../../core/services/odata";
import { getEventParameter } from "../../core/utils/EventParam";
import { fetchCostCenterDeletePreview, buildCostCenterDeleteSummary } from "../../services/deletePreview.service";

type ODataContext = NonNullable<Context>;
type CreationContext = {
  created(): Promise<void> | undefined;
  delete(groupId?: string): Promise<void>;
};

export default class CostCenterHandler {
  private static readonly DIALOG_ID = "costCenterDialog";

  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor,
    private readonly selection: SelectionState,
    private readonly guard: UnsavedChangesGuard
  ) {}

  private getI18nBundle(): ResourceBundle {
    const view = this.controller.getView();
    const model = view?.getModel("i18n") as ResourceModel;
    return model.getResourceBundle() as ResourceBundle;
  }

  public refresh(): void {
    this.getCostCentersBinding()?.refresh();
  }

  public startCreate(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const dialogModel = this.models.getCostCenterModel();
    dialogModel.setData({
      mode: "create",
      title: i18n.getText("addCostCenter"),
      costCenter: {
        code: "",
        name: "",
        description: "",
        validFrom: "",
        validTo: "",
        responsible_ID: undefined,
      },
    });
    this.guard.markDirty(CostCenterHandler.DIALOG_ID);
    this.openDialog();
  }

  public async startEdit(): Promise<void> {
    if (!this.selection.ensureCostCenterSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedCostCenterContext();
    if (!context) {
      MessageBox.error(i18n.getText("noCostCenterSelected"));
      return;
    }
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
        validFrom?: string;
        validTo?: string;
        responsible_ID?: string;
        responsible?: { ID?: string };
      } | undefined;
      if (!currentData) {
        MessageBox.error(i18n.getText("unableToLoadCostCenter"));
        return;
      }

      const dialogModel = this.models.getCostCenterModel();
      dialogModel.setData({
        mode: "edit",
        title: i18n.getText("editCostCenter"),
        costCenter: {
          ID: currentData.ID,
          code: currentData.code ?? "",
          name: currentData.name ?? "",
          description: currentData.description ?? "",
          validFrom: currentData.validFrom ?? "",
          validTo: currentData.validTo ?? "",
          responsible_ID: currentData.responsible_ID ?? currentData.responsible?.ID,
        },
      });
      this.guard.markDirty(CostCenterHandler.DIALOG_ID);
      this.openDialog();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : i18n.getText("unableToLoadCostCenter");
      MessageBox.error(message);
    } finally {
      view.setBusy(false);
    }
  }

  public delete(): void {
    if (!this.selection.ensureCostCenterSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedCostCenterContext();
    if (!context) {
      MessageBox.error(i18n.getText("noCostCenterSelected"));
      return;
    }
    const costCenter = context.getObject() as { ID?: string; code?: string; name?: string };
    const costCenterId = costCenter.ID;
    const title = costCenter.code
      ? `${costCenter.code}${costCenter.name ? " - " + costCenter.name : ""}`
      : costCenter.name ?? "";

    if (!costCenterId) {
      MessageBox.error(i18n.getText("noCostCenterSelected"));
      return;
    }

    // Fetch delete preview to show impact
    const view = this.controller.getView();
    if (view) {
      view.setBusy(true);
    }

    fetchCostCenterDeletePreview(costCenterId)
      .then((preview) => {
        if (view) {
          view.setBusy(false);
        }

        const summary = buildCostCenterDeleteSummary(preview);
        let confirmMessage = `${i18n.getText("deleteCostCenterMessage")} ${title}?`;

        if (summary) {
          confirmMessage += `\n\n${i18n.getText("deleteCostCenterWarning") || "This will affect:"}\n${summary}`;
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
                  MessageToast.show(i18n.getText("costCenterDeleted"));
                  this.selection.clearCostCenter();
                })
                .catch((error: Error) => {
                  MessageBox.error(error.message ?? i18n.getText("failedToDeleteCostCenter"));
                });
            }
          },
        });
      })
      .catch((error) => {
        if (view) {
          view.setBusy(false);
        }
        console.warn("Failed to fetch delete preview, proceeding with basic confirmation", error instanceof Error ? error.message : String(error));

        // Fall back to basic confirmation if preview fails
        MessageBox.confirm(`${i18n.getText("deleteCostCenterMessage")} ${title}?`, {
          title: i18n.getText("confirm"),
          emphasizedAction: MessageBox.Action.OK,
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          onClose: (action: string) => {
            if (action === MessageBox.Action.OK) {
              context
                .delete("$auto")
                .then(() => {
                  MessageToast.show(i18n.getText("costCenterDeleted"));
                  this.selection.clearCostCenter();
                })
                .catch((deleteError: Error) => {
                  console.error("Error deleting cost center", deleteError);
                  MessageBox.error(deleteError.message ?? i18n.getText("failedToDeleteCostCenter"));
                });
            }
          },
        });
      });
  }

  public save(): void {
    const i18n = this.getI18nBundle();
    const dialog = this.byId("costCenterDialog") as Dialog;
    if (!dialog) {
      MessageBox.error(i18n.getText("errorOccurred"));
      return;
    }
    const dialogModel = this.models.getCostCenterModel();
    const data = dialogModel.getData();
    const clientId = this.selection.getSelectedClientId();

    const payload: Record<string, unknown> = {
      code: data.costCenter.code?.trim() ?? "",
      name: data.costCenter.name?.trim() ?? "",
      description: data.costCenter.description?.trim() ?? "",
      validFrom: data.costCenter.validFrom,
      validTo: data.costCenter.validTo || null,
      responsible_ID: data.costCenter.responsible_ID,
    };

    if (!payload.code || !payload.name || !payload.responsible_ID || !payload.validFrom) {
      MessageBox.error(i18n.getText("costCenterFieldsRequiredError"));
      return;
    }

    // Validate date range: validFrom must be before or equal to validTo
    // Compare as strings (YYYY-MM-DD format from DatePicker) to avoid timezone issues
    const validFromStr = payload.validFrom as string;
    const validToStr = payload.validTo as string | null;
    if (validToStr && validFromStr > validToStr) {
      MessageBox.error(i18n.getText("costCenterDatesInvalid"));
      return;
    }

    if (!clientId) {
      MessageBox.error(i18n.getText("selectClientFirst"));
      return;
    }

    payload.client_ID = clientId;

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getCostCentersBinding();
      if (!listBinding) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("unableToAccessCostCentersList"));
        return;
      }

      const creationContext = listBinding.create(payload) as Context | undefined;
      this.runWithCreationContext(
        creationContext,
        () => {
          dialog.setBusy(false);
          MessageBox.error(i18n.getText("failedToInitializeCostCenterCreation"));
        },
        (context) => {
          const readyContext = context as CreationContext & ODataContext;
          const model = readyContext.getModel() as ODataModel;

          const handleError = (error: unknown): void => {
            dialog.setBusy(false);
            const message =
              error instanceof Error && error.message
                ? error.message
                : i18n.getText("failedToCreateCostCenter");
            MessageBox.error(message);
            void readyContext.delete("$auto").catch(() => {
              // Silently ignore deletion errors for transient creation contexts
            });
          };

          let creationPromise: Promise<unknown>;

          try {
            creationPromise = readyContext.created?.() ?? Promise.resolve();
          } catch (error) {
            handleError(error);
            return;
          }

          Promise.all([creationPromise, model.submitBatch("$auto")])
            .then(() => {
              dialog.setBusy(false);
              this.guard.markClean(CostCenterHandler.DIALOG_ID);
              dialog.close();
              MessageToast.show(i18n.getText("costCenterCreated"));
              listBinding.refresh();
            })
            .catch(handleError);
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedCostCenterContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("selectCostCenterFirst"));
        return;
      }

      const model = context.getModel() as ODataModel;
      context.setProperty("code", payload.code);
      context.setProperty("name", payload.name);
      context.setProperty("description", payload.description);
      context.setProperty("validFrom", payload.validFrom);
      context.setProperty("validTo", payload.validTo);
      context.setProperty("responsible_ID", payload.responsible_ID);
      model
        .submitBatch("$auto")
        .then(() => {
          dialog.setBusy(false);
          this.guard.markClean(CostCenterHandler.DIALOG_ID);
          dialog.close();
          MessageToast.show(i18n.getText("costCenterUpdated"));
          // Refresh the list to ensure any backend-normalized values (e.g., codes) are displayed consistently
          this.getCostCentersBinding()?.refresh();
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          MessageBox.error(error.message ?? i18n.getText("failedToUpdateCostCenter"));
        });
    }
  }

  public cancel(): void {
    this.guard.markClean(CostCenterHandler.DIALOG_ID);
    const dialog = this.byId("costCenterDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("costCenterDialog") as Dialog;
    dialog.setBusy(false);
    // Clear unsaved changes guard in case dialog was closed via ESC or X button
    this.guard.markClean(CostCenterHandler.DIALOG_ID);
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
