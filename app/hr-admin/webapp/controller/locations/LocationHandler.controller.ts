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

export default class LocationHandler {
  constructor(
    private readonly controller: Controller,
    private readonly models: DialogModelAccessor,
    private readonly selection: SelectionState
  ) {}

  public refresh(): void {
    this.getLocationsBinding()?.refresh();
  }

  public startCreate(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const dialogModel = this.models.getLocationModel();
    dialogModel.setData({
      mode: "create",
      title: "Add Location",
      location: {
        city: "",
        country_code: "",
        zipCode: "",
        street: "",
        addressSupplement: "",
        validFrom: "",
        validTo: "",
      },
    });
    this.openDialog();
  }

  public async startEdit(): Promise<void> {
    if (!this.selection.ensureLocationSelected()) {
      return;
    }

    const context = this.selection.getSelectedLocationContext();
    if (!context) {
      MessageBox.error("No location selected");
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
        city?: string;
        country_code?: string;
        zipCode?: string;
        street?: string;
        addressSupplement?: string;
        validFrom?: string;
        validTo?: string;
      } | undefined;
      if (!currentData) {
        MessageBox.error("Unable to load the selected location.");
        return;
      }

      const dialogModel = this.models.getLocationModel();
      dialogModel.setData({
        mode: "edit",
        title: "Edit Location",
        location: {
          ID: currentData.ID,
          city: currentData.city ?? "",
          country_code: currentData.country_code ?? "",
          zipCode: currentData.zipCode ?? "",
          street: currentData.street ?? "",
          addressSupplement: currentData.addressSupplement ?? "",
          validFrom: currentData.validFrom ?? "",
          validTo: currentData.validTo ?? "",
        },
      });
      this.openDialog();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load the selected location.";
      MessageBox.error(message);
    } finally {
      view.setBusy(false);
    }
  }

  public delete(): void {
    if (!this.selection.ensureLocationSelected()) {
      return;
    }

    const context = this.selection.getSelectedLocationContext();
    if (!context) {
      MessageBox.error("No location selected");
      return;
    }
    const location = context.getObject() as { street?: string; city?: string };
    const title = location.street
      ? `${location.street}, ${location.city ?? ""}`
      : location.city ?? "";
    MessageBox.confirm(`Delete location ${title}?`, {
      title: "Confirm Deletion",
      emphasizedAction: MessageBox.Action.OK,
      actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
      onClose: (action: string) => {
        if (action === MessageBox.Action.OK) {
          context
            .delete("$auto")
            .then(() => {
              MessageToast.show("Location deleted");
              this.selection.clearLocation();
            })
            .catch((error: Error) => {
              MessageBox.error(error.message ?? "Failed to delete location");
            });
        }
      },
    });
  }

  public save(): void {
    const dialog = this.byId("locationDialog") as Dialog;
    if (!dialog) {
      MessageBox.error("Dialog not found");
      return;
    }
    const dialogModel = this.models.getLocationModel();
    const data = dialogModel.getData();
    const clientId = this.selection.getSelectedClientId();

    const payload: Record<string, unknown> = {
      city: data.location.city?.trim() ?? "",
      country_code: data.location.country_code?.trim() ?? "",
      zipCode: data.location.zipCode?.trim() ?? "",
      street: data.location.street?.trim() ?? "",
      addressSupplement: data.location.addressSupplement?.trim() || null,
      validFrom: data.location.validFrom ?? "",
      validTo: data.location.validTo || null,
    };

    if (!payload.city || !payload.country_code || !payload.zipCode || !payload.street || !payload.validFrom) {
      MessageBox.error("City, Country, ZIP Code, Street, and Valid From are required.");
      return;
    }

    if (!clientId) {
      MessageBox.error("Select a client first.");
      return;
    }

    payload.client_ID = clientId;

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getLocationsBinding();
      if (!listBinding) {
        dialog.setBusy(false);
        MessageBox.error("Unable to access locations list.");
        return;
      }

      const creationContext = listBinding.create(payload) as Context | undefined;
      this.runWithCreationContext(
        creationContext,
        () => {
          dialog.setBusy(false);
          MessageBox.error("Failed to initialize location creation context.");
        },
        (context) => {
          const readyContext = context as CreationContext & ODataContext;
          const model = readyContext.getModel() as ODataModel;

          const handleError = (error: unknown): void => {
            dialog.setBusy(false);
            const message =
              error instanceof Error && error.message
                ? error.message
                : "Failed to create location";
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
              dialog.close();
              MessageToast.show("Location created");
              listBinding.refresh();
            })
            .catch(handleError);
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedLocationContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error("Select a location first.");
        return;
      }

      const model = context.getModel() as ODataModel;
      context.setProperty("city", payload.city);
      context.setProperty("country_code", payload.country_code);
      context.setProperty("zipCode", payload.zipCode);
      context.setProperty("street", payload.street);
      context.setProperty("addressSupplement", payload.addressSupplement);
      context.setProperty("validFrom", payload.validFrom);
      context.setProperty("validTo", payload.validTo);
      model
        .submitBatch("$auto")
        .then(() => {
          dialog.setBusy(false);
          dialog.close();
          MessageToast.show("Location updated");
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          MessageBox.error(error.message ?? "Failed to update location");
        });
    }
  }

  public cancel(): void {
    const dialog = this.byId("locationDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("locationDialog") as Dialog;
    dialog.setBusy(false);
  }

  public handleSelectionChange(event: Event): void {
    const listItem = getEventParameter<ListItemBase | null>(event, "listItem") ?? null;
    const context = listItem ? (listItem.getBindingContext() as Context) : undefined;
    this.selection.setLocation(context || undefined);
  }

  private getLocationsBinding(): ODataListBinding | undefined {
    return getOptionalListBinding(this.controller, "locationsList");
  }

  private openDialog(): void {
    const dialog = this.byId("locationDialog") as Dialog;
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
