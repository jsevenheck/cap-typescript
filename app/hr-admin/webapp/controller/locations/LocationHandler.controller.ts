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
import Log from "sap/base/Log";

import DialogModelAccessor from "../../services/dialogModel.service";
import SelectionState from "../../services/selection.service";
import UnsavedChangesGuard from "../../core/guards/UnsavedChangesGuard";
import { getOptionalListBinding } from "../../core/services/odata";
import { getEventParameter } from "../../core/utils/EventParam";
import { fetchLocationDeletePreview, buildLocationDeleteSummary } from "../../services/deletePreview.service";

type ODataContext = NonNullable<Context>;
type CreationContext = {
  created(): Promise<void> | undefined;
  delete(groupId?: string): Promise<void>;
};

export default class LocationHandler {
  private static readonly DIALOG_ID = "locationDialog";

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
    this.getLocationsBinding()?.refresh();
  }

  public startCreate(): void {
    if (!this.selection.ensureClientSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const dialogModel = this.models.getLocationModel();
    dialogModel.setData({
      mode: "create",
      title: i18n.getText("addLocation"),
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
    this.guard.markDirty(LocationHandler.DIALOG_ID);
    this.openDialog();
  }

  public async startEdit(): Promise<void> {
    if (!this.selection.ensureLocationSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedLocationContext();
    if (!context) {
      MessageBox.error(i18n.getText("noLocationSelected"));
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
        MessageBox.error(i18n.getText("unableToLoadLocation"));
        return;
      }

      const dialogModel = this.models.getLocationModel();
      dialogModel.setData({
        mode: "edit",
        title: i18n.getText("editLocation"),
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
      this.guard.markDirty(LocationHandler.DIALOG_ID);
      this.openDialog();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : i18n.getText("unableToLoadLocation");
      MessageBox.error(message);
    } finally {
      view.setBusy(false);
    }
  }

  public delete(): void {
    if (!this.selection.ensureLocationSelected()) {
      return;
    }

    const i18n = this.getI18nBundle();
    const context = this.selection.getSelectedLocationContext();
    if (!context) {
      MessageBox.error(i18n.getText("noLocationSelected"));
      return;
    }
    const location = context.getObject() as { ID?: string; street?: string; city?: string };
    const locationId = location.ID;
    const title = location.street
      ? `${location.street}, ${location.city ?? ""}`
      : location.city ?? "";

    if (!locationId) {
      MessageBox.error(i18n.getText("noLocationSelected"));
      return;
    }

    // Fetch delete preview to show impact
    const view = this.controller.getView();
    if (view) {
      view.setBusy(true);
    }

    fetchLocationDeletePreview(locationId)
      .then((preview) => {
        if (view) {
          view.setBusy(false);
        }

        const summary = buildLocationDeleteSummary(preview);
        let confirmMessage = `${i18n.getText("deleteLocationMessage")} ${title}?`;

        if (summary) {
          confirmMessage += `\n\n${i18n.getText("deleteLocationWarning") || "This will affect:"}\n${summary}`;
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
                  MessageToast.show(i18n.getText("locationDeleted"));
                  this.selection.clearLocation();
                })
                .catch((error: Error) => {
                  MessageBox.error(error.message ?? i18n.getText("failedToDeleteLocation"));
                });
            }
          },
        });
      })
      .catch((error) => {
        if (view) {
          view.setBusy(false);
        }
        Log.warning("Failed to fetch delete preview, proceeding with basic confirmation", error instanceof Error ? error.message : String(error), "hr.admin.LocationHandler");

        // Fall back to basic confirmation if preview fails
        MessageBox.confirm(`${i18n.getText("deleteLocationMessage")} ${title}?`, {
          title: i18n.getText("confirm"),
          emphasizedAction: MessageBox.Action.OK,
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          onClose: (action: string) => {
            if (action === MessageBox.Action.OK) {
              context
                .delete("$auto")
                .then(() => {
                  MessageToast.show(i18n.getText("locationDeleted"));
                  this.selection.clearLocation();
                })
                .catch((deleteError: Error) => {
                  Log.error("Error deleting location", deleteError.message, "hr.admin.LocationHandler");
                  MessageBox.error(deleteError.message ?? i18n.getText("failedToDeleteLocation"));
                });
            }
          },
        });
      });
  }

  public save(): void {
    const i18n = this.getI18nBundle();
    const dialog = this.byId("locationDialog") as Dialog;
    if (!dialog) {
      MessageBox.error(i18n.getText("errorOccurred"));
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
      MessageBox.error(i18n.getText("locationFieldsRequired"));
      return;
    }

    // Validate date range: validFrom must be before validTo
    // Compare as strings (YYYY-MM-DD format from DatePicker) to avoid timezone issues
    const validFromStr = payload.validFrom as string;
    const validToStr = payload.validTo as string | null;
    if (validToStr && validFromStr > validToStr) {
      MessageBox.error(i18n.getText("locationDatesInvalid"));
      return;
    }

    if (!clientId) {
      MessageBox.error(i18n.getText("selectClientFirst"));
      return;
    }

    payload.client_ID = clientId;

    dialog.setBusy(true);

    if (data.mode === "create") {
      const listBinding = this.getLocationsBinding();
      if (!listBinding) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("unableToAccessLocationsList"));
        return;
      }

      const creationContext = listBinding.create(payload) as Context | undefined;
      this.runWithCreationContext(
        creationContext,
        () => {
          dialog.setBusy(false);
          MessageBox.error(i18n.getText("failedToInitializeLocationCreation"));
        },
        (context) => {
          const readyContext = context as CreationContext & ODataContext;
          const model = readyContext.getModel() as ODataModel;

          const handleError = (error: unknown): void => {
            dialog.setBusy(false);
            const message =
              error instanceof Error && error.message
                ? error.message
                : i18n.getText("failedToCreateLocation");
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
              this.guard.markClean(LocationHandler.DIALOG_ID);
              dialog.close();
              MessageToast.show(i18n.getText("locationCreated"));
              listBinding.refresh();
            })
            .catch(handleError);
        }
      );
    } else if (data.mode === "edit") {
      const context = this.selection.getSelectedLocationContext();
      if (!context) {
        dialog.setBusy(false);
        MessageBox.error(i18n.getText("selectLocationFirst"));
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
          this.guard.markClean(LocationHandler.DIALOG_ID);
          dialog.close();
          MessageToast.show(i18n.getText("locationUpdated"));
          // Refresh the list to ensure backend-normalized values are reflected (e.g., country formatting)
          this.getLocationsBinding()?.refresh();
        })
        .catch((error: Error) => {
          dialog.setBusy(false);
          MessageBox.error(error.message ?? i18n.getText("failedToUpdateLocation"));
        });
    }
  }

  public cancel(): void {
    this.guard.markClean(LocationHandler.DIALOG_ID);
    const dialog = this.byId("locationDialog") as Dialog;
    dialog.close();
  }

  public afterDialogClose(): void {
    const dialog = this.byId("locationDialog") as Dialog;
    dialog.setBusy(false);
    // Clear unsaved changes guard in case dialog was closed via ESC or X button
    this.guard.markClean(LocationHandler.DIALOG_ID);
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
