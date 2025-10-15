import Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import Select from "sap/m/Select";
import Event from "sap/ui/base/Event";
import Controller from "sap/ui/core/mvc/Controller";
import ListItemBase from "sap/m/ListItemBase";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import { EmployeeDialogModelData } from "../../types/DialogTypes";
import { getOptionalListBinding } from "../../core/services/odata";
import { formatPersonName } from "../../core/utils/Formatters";
import { getEventParameter } from "../../core/utils/EventParam";

type ODataContext = NonNullable<Context>;
type CreationContext = {
  created(): Promise<void> | undefined;
  delete(groupId?: string): Promise<void>;
};

export default class EmployeeHandler {
  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor,
    private readonly selection: SelectionState
  ) {}

  public refresh(): void {
    this.getEmployeesBinding()?.refresh();
  }

  public startCreate(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const dialogModel = this.models.getEmployeeModel();
    dialogModel.setData({
      mode: "create",
      title: "Add Employee",
      employee: {
        employeeId: "",
        firstName: "",
        lastName: "",
        email: "",
        costCenter_ID: undefined,
        manager_ID: undefined,
        managerName: "",
        location: "",
        positionLevel: "",
        entryDate: "",
        exitDate: "",
        status: "active",
        employmentType: "internal",
      },
    });
    this.openDialog();
  }

  public async startEdit(): Promise<void> {
    if (!this.selection.ensureEmployeeSelected()) {
      return;
    }

    const context = this.selection.getSelectedEmployeeContext() as Context;
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
        costCenter_ID?: string;
        costCenter?: { ID?: string };
        manager_ID?: string;
        manager?: { ID?: string; firstName?: string; lastName?: string };
        location?: string;
        positionLevel?: string;
        entryDate?: string;
        exitDate?: string | null;
        status?: EmployeeDialogModelData["employee"]["status"];
        employmentType?: EmployeeDialogModelData["employee"]["employmentType"];
      } | undefined;
      if (!currentData) {
        MessageBox.error("Unable to load the selected employee.");
        return;
      }

      const dialogModel = this.models.getEmployeeModel();
      const managerName = formatPersonName(
        currentData.manager?.firstName,
        currentData.manager?.lastName
      );
      dialogModel.setData({
        mode: "edit",
        title: "Edit Employee",
        employee: {
          ID: currentData.ID,
          employeeId: currentData.employeeId ?? "",
          firstName: currentData.firstName ?? "",
          lastName: currentData.lastName ?? "",
          email: currentData.email ?? "",
          costCenter_ID: currentData.costCenter_ID ?? currentData.costCenter?.ID,
          manager_ID: currentData.manager_ID ?? currentData.manager?.ID,
          managerName,
          location: currentData.location ?? "",
          positionLevel: currentData.positionLevel ?? "",
          entryDate: currentData.entryDate ?? "",
          exitDate: currentData.exitDate ?? "",
          status: currentData.status ?? "active",
          employmentType: currentData.employmentType ?? "internal",
        },
      });
      this.openDialog();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load the selected employee.";
      MessageBox.error(message);
    } finally {
      view.setBusy(false);
    }
  }

  public delete(): void {
    if (!this.selection.ensureEmployeeSelected()) {
      return;
    }

    const context = this.selection.getSelectedEmployeeContext() as Context;
    const employee = context.getObject() as { firstName?: string; lastName?: string };
    const name = formatPersonName(employee.firstName, employee.lastName);
    MessageBox.confirm(`Delete employee ${name}?`, {
      title: "Confirm Deletion",
      emphasizedAction: MessageBox.Action.OK,
      actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
      onClose: (action: string) => {
        if (action === MessageBox.Action.OK) {
          context
            .delete("$auto")
            .then(() => {
              MessageToast.show("Employee deleted");
              this.selection.clearEmployee();
            })
            .catch((error: Error) => {
              MessageBox.error(error.message ?? "Failed to delete employee");
            });
        }
      },
    });
  }

  public save(): void {
    const dialog = this.byId("employeeDialog") as Dialog;
    const dialogModel = this.models.getEmployeeModel();
    const data = dialogModel.getData();
    const clientId = this.selection.getSelectedClientId();
    const costCenterId = data.employee.costCenter_ID || undefined;
    const managerId = data.employee.manager_ID || undefined;
    const employeeIdValue = data.employee.employeeId?.trim() ?? "";

    const entryDateValue = data.employee.entryDate?.trim() ?? "";
    const exitDateValue = data.employee.exitDate?.trim() ?? "";

    const payload: Record<string, unknown> = {
      employeeId: employeeIdValue,
      firstName: data.employee.firstName?.trim() ?? "",
      lastName: data.employee.lastName?.trim() ?? "",
      email: data.employee.email?.trim() ?? "",
      location: data.employee.location?.trim() ?? "",
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

    if (!payload.employeeId) {
      MessageBox.error("Employee ID is required.");
      return;
    }

    if (
      !payload.firstName ||
      !payload.lastName ||
      !payload.email ||
      !payload.entryDate ||
      !payload.status ||
      !payload.employmentType
    ) {
      MessageBox.error("First name, last name, email, entry date, status, and employment type are required.");
      return;
    }

    const entryDate = payload.entryDate as string;
    const exitDate = (payload.exitDate as string | null) ?? null;

    if (exitDate && exitDate < entryDate) {
      MessageBox.error("Exit date cannot be before entry date.");
      return;
    }

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getEmployeesBinding();
      if (!listBinding) {
        dialog.setBusy(false);
        MessageBox.error("Unable to access employees list.");
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
          MessageBox.error("Failed to initialize employee creation context.");
        },
        (context) => {
          const readyContext = context as CreationContext;
          const creationPromise = readyContext.created?.();

          if (!creationPromise) {
            dialog.setBusy(false);
            dialog.close();
            MessageToast.show("Employee created");
            return;
          }

          creationPromise
            .then(() => {
              dialog.setBusy(false);
              dialog.close();
              MessageToast.show("Employee created");
            })
            .catch((error: Error) => {
              dialog.setBusy(false);
              MessageBox.error(error.message ?? "Failed to create employee");
              readyContext.delete("$auto");
            });
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedEmployeeContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error("Select an employee first.");
        return;
      }

      const model = context.getModel() as ODataModel;
      context.setProperty("employeeId", payload.employeeId);
      context.setProperty("firstName", payload.firstName);
      context.setProperty("lastName", payload.lastName);
      context.setProperty("email", payload.email);
      context.setProperty("location", payload.location);
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
          dialog.close();
          MessageToast.show("Employee updated");
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          model.resetChanges();
          MessageBox.error(error.message ?? "Failed to update employee");
        });
    }
  }

  public cancel(): void {
    const dialog = this.byId("employeeDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("employeeDialog") as Dialog;
    dialog.setBusy(false);
  }

  public handleSelectionChange(event: Event): void {
    const listItem = getEventParameter<ListItemBase | null>(event, "listItem") ?? null;
    const context = listItem ? (listItem.getBindingContext() as Context) : undefined;
    this.selection.setEmployee(context || undefined);
  }

  public handleCostCenterChange(event: Event): void {
    const select = event.getSource() as Select;
    const bindingContext = select.getSelectedItem()?.getBindingContext() as Context | undefined;
    const dialogModel = this.models.getEmployeeModel();
    const costCenterId = select.getSelectedKey() || undefined;
    dialogModel.setProperty("/employee/costCenter_ID", costCenterId);

    if (bindingContext) {
      const responsibleId = bindingContext.getProperty("responsible_ID") as string | undefined;
      const managerName = formatPersonName(
        bindingContext.getProperty("responsible/firstName") as string | undefined,
        bindingContext.getProperty("responsible/lastName") as string | undefined
      );
      dialogModel.setProperty("/employee/manager_ID", responsibleId);
      dialogModel.setProperty("/employee/managerName", managerName);
    } else {
      dialogModel.setProperty("/employee/manager_ID", undefined);
      dialogModel.setProperty("/employee/managerName", "");
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
