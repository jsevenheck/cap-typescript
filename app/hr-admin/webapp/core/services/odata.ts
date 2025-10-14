import List from "sap/m/List";
import Controller from "sap/ui/core/mvc/Controller";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";

export function getRequiredListBinding(controller: Controller, listId: string): ODataListBinding {
  const list = controller.byId(listId) as List | undefined;
  if (!list) {
    throw new Error(`List with id ${listId} not found.`);
  }

  const binding = list.getBinding("items");
  if (!binding) {
    throw new Error(`Items binding for list ${listId} is not available.`);
  }

  return binding as ODataListBinding;
}

export function getOptionalListBinding(
  controller: Controller,
  listId: string
): ODataListBinding | undefined {
  const list = controller.byId(listId) as List | undefined;
  if (!list) {
    return undefined;
  }

  const binding = list.getBinding("items");
  return binding ? (binding as ODataListBinding) : undefined;
}
