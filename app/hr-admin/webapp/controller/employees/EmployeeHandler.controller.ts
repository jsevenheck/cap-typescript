import Dialog from "sap/m/Dialog";
import List from "sap/m/List";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import DatePicker from "sap/m/DatePicker";
import Select from "sap/m/Select";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import { ValueState } from "sap/ui/core/library";
import ListItemBase from "sap/m/ListItemBase";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import UnsavedChangesGuard from "../../core/guards/UnsavedChangesGuard";
import { EmployeeDialogModelData } from "../../types/DialogTypes";
import { getOptionalListBinding } from "../../core/services/odata";
import { formatPersonName } from "../../core/utils/Formatters";
import { getEventParameter } from "../../core/utils/EventParam";

type ODataContext = NonNullable<Context>;
type CreationContext = {
  created(): Promise<void> | undefined;
  delete(groupId?: string): Promise<void>;
};

/**
 * Validates email format using RFC 5322 compliant regex pattern
 * Prevents common validation bypasses and ensures proper email format
 */
function isValidEmail(email: string): boolean {
  // RFC 5322 compliant email regex (simplified but robust)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  // Additional validation checks
  if (!emailRegex.test(email)) {
    return false;
  }

  // Check length constraints
  if (email.length > 254) {
    return false;
  }

  // Check local part (before @) length
  const parts = email.split('@');
  if (parts[0].length > 64) {
    return false;
  }

  // Ensure domain has at least one dot
  const domain = parts[1];
  if (!domain || !domain.includes('.')) {
    return false;
  }

  // Ensure domain doesn't start or end with dot or hyphen
  if (domain.startsWith('.') || domain.startsWith('-') ||
      domain.endsWith('.') || domain.endsWith('-')) {
    return false;
  }

  return true;
}

/**
 * Validates phone number format.
 * Allows empty string or phone numbers with optional leading +,
 * followed by at least one digit and optional formatting characters.
 */
function isValidPhoneNumber(phoneNumber: string): boolean {
  if (!phoneNumber || phoneNumber.trim() === "") {
    return true; // Empty is valid (optional field)
  }

  // Pattern: optional +, then at least one digit, then optional formatting chars
  // Max length 30 characters (matches backend schema: String(30) with {0,29} regex)
  const phoneRegex = /^\+?[0-9][0-9\s\-\(\)\.]{0,29}$/;
  
  return phoneRegex.test(phoneNumber);
}

export default class EmployeeHandler {
  private static readonly DIALOG_ID = "employeeDialog";
  private currentManagerLookupToken: number = 0;

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
    this.getEmployeesBinding()?.refresh();
  }

  public startCreate(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const dialogModel = this.models.getEmployeeModel();
    dialogModel.setData({
      mode: "create",
      title: i18n.getText("addEmployee"),
      employee: {
        employeeId: "",
        firstName: "",
        lastName: "",
        email: "",
        phoneNumber: "",
        costCenter_ID: undefined,
        manager_ID: undefined,
        managerName: "",
        location_ID: undefined,
        positionLevel: "",
        entryDate: "",
        exitDate: "",
        status: "active",
        employmentType: "internal",
      },
      managerLookupPending: false,
    });
    this.guard.markDirty(EmployeeHandler.DIALOG_ID);
    this.openDialog();
  }

  public async startEdit(): Promise<void> {
    if (!this.selection.ensureEmployeeSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedEmployeeContext();
    if (!context) {
      MessageBox.error(i18n.getText("noEmployeeSelected"));
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
        employeeId?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phoneNumber?: string;
        costCenter_ID?: string;
        costCenter?: { ID?: string };
        manager_ID?: string;
        manager?: { ID?: string; firstName?: string; lastName?: string };
        location_ID?: string;
        location?: { ID?: string };
        positionLevel?: string;
        entryDate?: string;
        exitDate?: string | null;
        status?: EmployeeDialogModelData["employee"]["status"];
        employmentType?: EmployeeDialogModelData["employee"]["employmentType"];
      } | undefined;
      if (!currentData) {
        MessageBox.error(i18n.getText("unableToLoadEmployee"));
        return;
      }

      const dialogModel = this.models.getEmployeeModel();
      const managerName = formatPersonName(
        currentData.manager?.firstName,
        currentData.manager?.lastName
      );
      dialogModel.setData({
        mode: "edit",
        title: i18n.getText("editEmployee"),
        employee: {
          ID: currentData.ID,
          employeeId: currentData.employeeId ?? "",
          firstName: currentData.firstName ?? "",
          lastName: currentData.lastName ?? "",
          email: currentData.email ?? "",
          phoneNumber: currentData.phoneNumber ?? "",
          costCenter_ID: currentData.costCenter_ID ?? currentData.costCenter?.ID,
          manager_ID: currentData.manager_ID ?? currentData.manager?.ID,
          managerName,
          location_ID: currentData.location_ID ?? currentData.location?.ID,
          positionLevel: currentData.positionLevel ?? "",
          entryDate: currentData.entryDate ?? "",
          exitDate: currentData.exitDate ?? "",
          status: currentData.status ?? "active",
          employmentType: currentData.employmentType ?? "internal",
        },
        managerLookupPending: false,
      });
      this.guard.markDirty(EmployeeHandler.DIALOG_ID);
      this.openDialog();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : i18n.getText("unableToLoadEmployee");
      MessageBox.error(message);
    } finally {
      view.setBusy(false);
    }
  }

  public delete(): void {
    if (!this.selection.ensureEmployeeSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedEmployeeContext() as Context;
    const employee = context.getObject() as { firstName?: string; lastName?: string };
    const name = formatPersonName(employee.firstName, employee.lastName);
    MessageBox.confirm(`${i18n.getText("deleteEmployeeMessage")} ${name}?`, {
      title: i18n.getText("confirm"),
      emphasizedAction: MessageBox.Action.OK,
      actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
      onClose: (action: string) => {
        if (action === MessageBox.Action.OK) {
          context
            .delete("$auto")
            .then(() => {
              MessageToast.show(i18n.getText("employeeDeleted"));
              this.selection.clearEmployee();
            })
            .catch((error: Error) => {
              MessageBox.error(error.message ?? i18n.getText("failedToDeleteEmployee"));
            });
        }
      },
    });
  }

  public save(): void {
    const i18n = this.getI18nBundle();
    const dialog = this.byId("employeeDialog") as Dialog;
    if (!dialog) {
      MessageBox.error(i18n.getText("errorOccurred"));
      return;
    }
    const dialogModel = this.models.getEmployeeModel();
    const managerLookupPending = Boolean(
      dialogModel.getProperty("/managerLookupPending")
    );
    if (managerLookupPending) {
      MessageBox.warning(i18n.getText("waitForManagerLookup"));
      return;
    }
    const data = dialogModel.getData();
    const clientId = this.selection.getSelectedClientId();
    const costCenterId = data.employee.costCenter_ID || undefined;
    const managerId = data.employee.manager_ID || undefined;
    const locationId = data.employee.location_ID || undefined;
    const employeeIdValue = data.employee.employeeId?.trim();

    const entryDateValue = data.employee.entryDate?.trim() ?? "";
    const exitDateValue = data.employee.exitDate?.trim() ?? "";
    const phoneNumberValue = data.employee.phoneNumber?.trim() ?? "";

    const payload: Record<string, unknown> = {
      firstName: data.employee.firstName?.trim() ?? "",
      lastName: data.employee.lastName?.trim() ?? "",
      email: data.employee.email?.trim() ?? "",
      phoneNumber: phoneNumberValue || null,
      location_ID: locationId ?? null,
      positionLevel: data.employee.positionLevel?.trim() ?? "",
      costCenter_ID: costCenterId ?? null,
      manager_ID: managerId ?? null,
      entryDate: entryDateValue,
      exitDate: exitDateValue ? exitDateValue : null,
      status: data.employee.status,
      employmentType: data.employee.employmentType,
    };

    if (clientId) {
      payload.client_ID = clientId;
    }

    if (employeeIdValue) {
      payload.employeeId = employeeIdValue;
    }
    // Allow edits even if employeeId is not yet assigned; backend keeps existing value

    if (
      !payload.firstName ||
      !payload.lastName ||
      !payload.email ||
      !payload.location_ID ||
      !payload.entryDate ||
      !payload.status ||
      !payload.employmentType
    ) {
      MessageBox.error(i18n.getText("employeeFieldsRequired"));
      return;
    }

    // Validate email format
    if (typeof payload.email === 'string' && !isValidEmail(payload.email)) {
      MessageBox.error(i18n.getText("invalidEmail"));
      return;
    }

    // Validate phone number format
    if (typeof payload.phoneNumber === 'string' && !isValidPhoneNumber(payload.phoneNumber)) {
      MessageBox.error(i18n.getText("invalidPhoneNumber"));
      return;
    }

    const entryDate = payload.entryDate as string;
    const exitDate = (payload.exitDate as string | null) ?? null;
    const statusValue = (payload.status as string | undefined) ?? "";

    const exitDatePicker = this.byId("employeeExitDate") as DatePicker | undefined;
    const statusSelect = this.byId("employeeStatus") as Select | undefined;
    exitDatePicker?.setValueState(ValueState.None);
    exitDatePicker?.setValueStateText("");
    statusSelect?.setValueState(ValueState.None);
    statusSelect?.setValueStateText("");

    // Compare as strings (YYYY-MM-DD) to avoid timezone issues
    if (exitDate && entryDate && exitDate < entryDate) {
      exitDatePicker?.setValueState(ValueState.Error);
      exitDatePicker?.setValueStateText(i18n.getText("exitDateBeforeEntryDate"));
      MessageBox.error(i18n.getText("exitDateBeforeEntryDate"));
      return;
    }

    if (statusValue === "inactive" && !exitDate) {
      exitDatePicker?.setValueState(ValueState.Error);
      exitDatePicker?.setValueStateText(i18n.getText("inactiveEmployeesMustHaveExitDate"));
      MessageBox.error(i18n.getText("inactiveEmployeesMustHaveExitDate"));
      return;
    }

    if (statusValue !== "inactive" && exitDate) {
      statusSelect?.setValueState(ValueState.Error);
      statusSelect?.setValueStateText(i18n.getText("employeesWithExitDateMustBeInactive"));
      MessageBox.error(i18n.getText("employeesWithExitDateMustBeInactive"));
      return;
    }

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getEmployeesBinding();
      if (!listBinding) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("unableToAccessEmployeesList"));
        return;
      }

      const creationContext = listBinding.create(payload) as Context | undefined;
      this.runWithCreationContext(
        creationContext,
        () => {
          dialog.setBusy(false);
          MessageBox.error(i18n.getText("failedToInitializeEmployeeCreation"));
        },
        (context) => {
          const readyContext = context as CreationContext & ODataContext;
          const model = readyContext.getModel() as ODataModel;

          const handleError = (error: unknown): void => {
            dialog.setBusy(false);
            const message =
              error instanceof Error && error.message
                ? error.message
                : i18n.getText("failedToCreateEmployee");
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

          Promise.all([creationPromise, model.submitBatch("$auto")])
            .then(() => {
              dialog.setBusy(false);
              this.guard.markClean(EmployeeHandler.DIALOG_ID);
              dialog.close();
              MessageToast.show(i18n.getText("employeeCreated"));
              listBinding.refresh();
            })
            .catch(handleError);
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedEmployeeContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("selectEmployeeFirst"));
        return;
      }

      const model = context.getModel() as ODataModel;
      // Validate and sanitize employee ID
      const trimmedEmployeeId = employeeIdValue?.trim();
      if (trimmedEmployeeId) {
        if (trimmedEmployeeId.length > 60) {
          dialog.setBusy(false);
          MessageBox.error(i18n.getText("employeeIdTooLongError"));
          return;
        }
        context.setProperty("employeeId", trimmedEmployeeId.toUpperCase());
      }
      context.setProperty("firstName", payload.firstName);
      context.setProperty("lastName", payload.lastName);
      context.setProperty("email", payload.email);
      context.setProperty("phoneNumber", payload.phoneNumber);
      context.setProperty("location_ID", payload.location_ID);
      context.setProperty("positionLevel", payload.positionLevel);
      context.setProperty("costCenter_ID", payload.costCenter_ID ?? null);
      context.setProperty("manager_ID", payload.manager_ID ?? null);
      context.setProperty("entryDate", payload.entryDate);
      context.setProperty("exitDate", payload.exitDate);
      context.setProperty("status", payload.status);
      context.setProperty("employmentType", payload.employmentType);
      model
        .submitBatch("$auto")
        .then(() => {
          dialog.setBusy(false);
          this.guard.markClean(EmployeeHandler.DIALOG_ID);
          dialog.close();
          MessageToast.show(i18n.getText("employeeUpdated"));
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          MessageBox.error(error.message ?? i18n.getText("failedToUpdateEmployee"));
        });
    }
  }

  public cancel(): void {
    this.guard.markClean(EmployeeHandler.DIALOG_ID);
    const dialog = this.byId("employeeDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("employeeDialog") as Dialog;
    dialog.setBusy(false);
    // Clear unsaved changes guard in case dialog was closed via ESC or X button
    this.guard.markClean(EmployeeHandler.DIALOG_ID);
  }

  public handleSelectionChange(event: Event): void {
    const listItem = getEventParameter<ListItemBase | null>(event, "listItem") ?? null;
    const context = listItem ? (listItem.getBindingContext() as Context) : undefined;
    this.selection.setEmployee(context || undefined);

    const assignmentsList = this.byId("assignmentsList") as List | undefined;
    if (assignmentsList) {
      assignmentsList.setBindingContext(context || null);
    }
  }

  public handleCostCenterChange(event: Event): void {
    // Increment token to invalidate previous requests
    this.currentManagerLookupToken++;
    const lookupToken = this.currentManagerLookupToken;

    const select = event.getSource() as Select;
    const bindingContext = select.getSelectedItem()?.getBindingContext() as Context | undefined;
    const dialogModel = this.models.getEmployeeModel();
    const costCenterId = select.getSelectedKey() || undefined;
    dialogModel.setProperty("/employee/costCenter_ID", costCenterId);
    const previousManagerId = dialogModel.getProperty("/employee/manager_ID") as string | undefined;
    const previousManagerName = dialogModel.getProperty("/employee/managerName") as string | undefined;

    const applyResponsible = (options?: {
      responsibleId?: string;
      firstName?: string;
      lastName?: string;
    }): void => {
      dialogModel.setProperty("/employee/manager_ID", options?.responsibleId ?? undefined);
      dialogModel.setProperty(
        "/employee/managerName",
        formatPersonName(options?.firstName, options?.lastName)
      );
    };

    const restorePreviousResponsible = (): void => {
      dialogModel.setProperty("/employee/manager_ID", previousManagerId ?? undefined);
      dialogModel.setProperty("/employee/managerName", previousManagerName ?? "");
    };

    const clearResponsible = (): void => {
      dialogModel.setProperty("/employee/manager_ID", undefined);
      dialogModel.setProperty("/employee/managerName", "");
    };

    if (bindingContext) {
      const responsibleId = bindingContext.getProperty("responsible_ID") as string | undefined;
      const managerFirstName = bindingContext.getProperty("responsible/firstName") as string | undefined;
      const managerLastName = bindingContext.getProperty("responsible/lastName") as string | undefined;

      if (responsibleId) {
        dialogModel.setProperty("/managerLookupPending", false);
        applyResponsible({
          responsibleId,
          firstName: managerFirstName,
          lastName: managerLastName,
        });
        return;
      }

      const selectedKey = select.getSelectedKey();
      dialogModel.setProperty("/managerLookupPending", true);
      clearResponsible();
      void bindingContext
        .requestObject()
        .then((costCenter: unknown) => {
          // Check if this request is still valid
          if (lookupToken !== this.currentManagerLookupToken) {
            return;
          }

          if (select.getSelectedKey() !== selectedKey) {
            return;
          }

          const data = costCenter as
            | {
                responsible_ID?: string;
                responsible?: { firstName?: string; lastName?: string };
              }
            | null
            | undefined;

          if (data?.responsible_ID) {
            applyResponsible({
              responsibleId: data.responsible_ID,
              firstName: data.responsible?.firstName,
              lastName: data.responsible?.lastName,
            });
          } else {
            clearResponsible();
          }
        })
        .catch(() => {
          // Check if this request is still valid
          if (lookupToken !== this.currentManagerLookupToken) {
            return;
          }

          if (select.getSelectedKey() === selectedKey) {
            restorePreviousResponsible();
          }
        })
        .finally(() => {
          // Check if this request is still valid
          if (lookupToken !== this.currentManagerLookupToken) {
            return;
          }

          if (select.getSelectedKey() === selectedKey) {
            dialogModel.setProperty("/managerLookupPending", false);
          }
        });
    } else {
      clearResponsible();
      dialogModel.setProperty("/managerLookupPending", false);
    }
  }

  private getEmployeesBinding(): ODataListBinding | undefined {
    return getOptionalListBinding(this.controller, "employeesList");
  }

  private openDialog(): void {
    const dialog = this.byId("employeeDialog") as Dialog;
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
