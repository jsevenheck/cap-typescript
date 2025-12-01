import Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import DatePicker from "sap/m/DatePicker";
import ListItemBase from "sap/m/ListItemBase";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import { ValueState } from "sap/ui/core/library";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import UnsavedChangesGuard from "../../core/guards/UnsavedChangesGuard";
import { AssignmentDialogModelData } from "../../types/DialogTypes";
import { getOptionalListBinding } from "../../core/services/odata";
import { getEventParameter } from "../../core/utils/EventParam";

export default class AssignmentHandler {
  private static readonly DIALOG_ID = "assignmentDialog";

  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor,
    private readonly selection: SelectionState,
    private readonly guard: UnsavedChangesGuard
  ) {}

  public refresh(): void {
    this.getAssignmentsBinding()?.refresh();
  }

  public startCreate(): void {
    if (!this.selection.ensureEmployeeSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const dialogModel = this.models.getAssignmentModel();
    dialogModel.setData({
      mode: "create",
      title: i18n.getText("addAssignment"),
      assignment: {
        costCenter_ID: undefined,
        validFrom: "",
        validTo: "",
        isResponsible: false,
      },
    });
    this.guard.markDirty(AssignmentHandler.DIALOG_ID);
    this.openDialog();
  }

  public async startEdit(): Promise<void> {
    if (!this.selection.ensureAssignmentSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedAssignmentContext();
    const view = this.controller.getView();
    if (!context || !view) {
      return;
    }

    view.setBusy(true);
    try {
      const currentData = (await context.requestObject()) as {
        ID?: string;
        costCenter_ID?: string;
        costCenter?: { ID?: string };
        validFrom?: string;
        validTo?: string | null;
        isResponsible?: boolean;
      } | undefined;

      if (!currentData) {
        MessageBox.error(i18n.getText("unableToLoadAssignment"));
        return;
      }

      const dialogModel = this.models.getAssignmentModel();
      dialogModel.setData({
        mode: "edit",
        title: i18n.getText("editAssignment"),
        assignment: {
          ID: currentData.ID,
          costCenter_ID: currentData.costCenter_ID ?? currentData.costCenter?.ID,
          validFrom: currentData.validFrom ?? "",
          validTo: currentData.validTo ?? "",
          isResponsible: Boolean(currentData.isResponsible),
        },
      });
      this.guard.markDirty(AssignmentHandler.DIALOG_ID);
      this.openDialog();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : i18n.getText("unableToLoadAssignment");
      MessageBox.error(message);
    } finally {
      view.setBusy(false);
    }
  }

  public delete(): void {
    if (!this.selection.ensureAssignmentSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedAssignmentContext();
    if (!context) {
      MessageBox.error(i18n.getText("noAssignmentSelected"));
      return;
    }

    MessageBox.confirm(i18n.getText("deleteAssignmentConfirm"), {
      actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
      emphasizedAction: MessageBox.Action.OK,
      onClose: (action) => {
        if (action === MessageBox.Action.OK) {
          context
            .delete("$auto")
            .then(() => {
              MessageToast.show(i18n.getText("assignmentDeleted"));
              this.selection.clearAssignment();
            })
            .catch((error: Error) => MessageBox.error(error.message ?? i18n.getText("failedToDeleteAssignment")));
        }
      },
    });
  }

  public save(): void {
    const i18n = this.getI18nBundle();
    const dialog = this.byId("assignmentDialog") as Dialog;
    if (!dialog) {
      MessageBox.error(i18n.getText("errorOccurred"));
      return;
    }

    const dialogModel = this.models.getAssignmentModel();
    const data = dialogModel.getData();
    const payload = this.buildPayload(data.assignment, i18n);

    if (!payload) {
      return;
    }

    dialog.setBusy(true);

    if (data.mode === "create") {
      const binding = this.getAssignmentsBinding();

      this.runWithCreationContext(
        binding,
        () => {
          dialog.setBusy(false);
          MessageBox.error(i18n.getText("unableToAccessAssignmentsList"));
        },
        (creationContext) => {
          creationContext
            .create(payload)
            .created()
            ?.then(() => {
              dialog.setBusy(false);
              dialog.close();
              this.guard.markClean(AssignmentHandler.DIALOG_ID);
              MessageToast.show(i18n.getText("assignmentCreated"));
            })
            ?.catch((error: Error) => {
              dialog.setBusy(false);
              MessageBox.error(error.message ?? i18n.getText("failedToCreateAssignment"));
            });
        }
      );
    } else {
      const context = this.selection.getSelectedAssignmentContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("noAssignmentSelected"));
        return;
      }

      context.setProperty("costCenter_ID", payload.costCenter_ID ?? null);
      context.setProperty("validFrom", payload.validFrom);
      context.setProperty("validTo", payload.validTo ?? null);
      context.setProperty("isResponsible", payload.isResponsible);

      const model = context.getModel() as ODataModel;
      model
        .submitBatch("$auto")
        .then(() => {
          dialog.setBusy(false);
          dialog.close();
          this.guard.markClean(AssignmentHandler.DIALOG_ID);
          MessageToast.show(i18n.getText("assignmentUpdated"));
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          MessageBox.error(error.message ?? i18n.getText("failedToUpdateAssignment"));
        });
    }
  }

  public cancel(): void {
    this.guard.markClean(AssignmentHandler.DIALOG_ID);
    const dialog = this.byId("assignmentDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("assignmentDialog") as Dialog;
    dialog.setBusy(false);
    this.guard.markClean(AssignmentHandler.DIALOG_ID);
  }

  public handleSelectionChange(event: Event): void {
    if (this.selection.isClearingListSelection("assignmentsList")) {
      return;
    }

    const listItem = getEventParameter<ListItemBase | null>(event, "listItem") ?? null;
    const context = listItem ? (listItem.getBindingContext() as Context) : undefined;
    this.selection.setAssignment(context || undefined);
  }

  private buildPayload(
    data: AssignmentDialogModelData["assignment"],
    i18n: ResourceBundle
  ):
    | {
        costCenter_ID?: string;
        validFrom: string;
        validTo?: string;
        isResponsible: boolean;
      }
    | null {
    const costCenterId = data.costCenter_ID || undefined;
    const validFrom = data.validFrom?.trim();
    const validTo = data.validTo?.trim();

    const validFromPicker = this.byId("assignmentValidFrom") as DatePicker | undefined;
    const validToPicker = this.byId("assignmentValidTo") as DatePicker | undefined;

    validFromPicker?.setValueState(ValueState.None);
    validToPicker?.setValueState(ValueState.None);
    validFromPicker?.setValueStateText("");
    validToPicker?.setValueStateText("");

    if (!costCenterId || !validFrom) {
      MessageBox.error(i18n.getText("assignmentFieldsRequired"));
      return null;
    }

    if (validTo && validTo < validFrom) {
      validToPicker?.setValueState(ValueState.Error);
      validToPicker?.setValueStateText(i18n.getText("assignmentDatesInvalid"));
      MessageBox.error(i18n.getText("assignmentDatesInvalid"));
      return null;
    }

    return {
      costCenter_ID: costCenterId,
      validFrom,
      validTo: validTo || undefined,
      isResponsible: Boolean(data.isResponsible),
    };
  }

  private getAssignmentsBinding(): ODataListBinding | undefined {
    return getOptionalListBinding(this.controller, "assignmentsList");
  }

  private openDialog(): void {
    const dialog = this.byId("assignmentDialog") as Dialog;
    dialog.setBusy(false);
    const employeeContext = this.selection.getSelectedEmployeeContext();
    if (employeeContext) {
      dialog.setBindingContext(employeeContext);
    }
    dialog.open();
  }

  private getI18nBundle(): ResourceBundle {
    const view = this.controller.getView();
    const model = view?.getModel("i18n") as ResourceModel;
    return model.getResourceBundle() as ResourceBundle;
  }

  private byId(id: string): unknown {
    return this.controller.byId(id);
  }

  private runWithCreationContext(
    binding: ODataListBinding | undefined,
    onMissing: () => void,
    onReady: (context: { create(data: unknown): Context & { created(): Promise<void> | undefined } }) => void
  ): void {
    if (!binding) {
      onMissing();
      return;
    }

    onReady(binding as unknown as { create(data: unknown): Context & { created(): Promise<void> | undefined } });
  }
}
