import UIComponent from "sap/ui/core/UIComponent";

export default UIComponent.extend("hr.admin.Component", {
  metadata: {
    manifest: "json",
  },

  init(this: UIComponent): void {
    UIComponent.prototype.init.call(this);
  },
});
