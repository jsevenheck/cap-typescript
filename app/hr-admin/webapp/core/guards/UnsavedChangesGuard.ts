import MessageBox from "sap/m/MessageBox";
import ResourceBundle from "sap/base/i18n/ResourceBundle";

/**
 * Navigation guard to prevent losing unsaved changes
 * Tracks dirty state of forms and dialogs across the application
 */
export default class UnsavedChangesGuard {
  private dirtyForms: Set<string> = new Set();
  private pendingNavigation: (() => void) | null = null;

  /**
   * Mark a form/dialog as having unsaved changes
   * @param formId Unique identifier for the form (e.g., "clientDialog", "employeeDialog")
   */
  public markDirty(formId: string): void {
    this.dirtyForms.add(formId);
  }

  /**
   * Mark a form/dialog as clean (saved or cancelled)
   * @param formId Unique identifier for the form
   */
  public markClean(formId: string): void {
    this.dirtyForms.delete(formId);
  }

  /**
   * Check if any form has unsaved changes
   */
  public hasDirtyForms(): boolean {
    return this.dirtyForms.size > 0;
  }

  /**
   * Clear all dirty state (use sparingly, typically on app init)
   */
  public clearAll(): void {
    this.dirtyForms.clear();
    this.pendingNavigation = null;
  }

  /**
   * Check if navigation should be allowed, showing confirmation if needed
   * @param i18n ResourceBundle for localized messages
   * @param onConfirm Callback to execute if user confirms navigation
   * @returns true if navigation should proceed immediately, false if blocked/pending
   */
  public checkNavigation(
    i18n: ResourceBundle,
    onConfirm: () => void
  ): boolean {
    if (!this.hasDirtyForms()) {
      return true;
    }

    // Show confirmation dialog
    this.pendingNavigation = onConfirm;

    MessageBox.warning(
      i18n.getText("unsavedChanges") || "You have unsaved changes. Do you want to discard them?",
      {
        title: i18n.getText("confirm") || "Confirm",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        emphasizedAction: MessageBox.Action.NO,
        onClose: (action: string) => {
          if (action === MessageBox.Action.YES) {
            // User confirmed - clear dirty state and proceed
            this.clearAll();
            if (this.pendingNavigation) {
              this.pendingNavigation();
              this.pendingNavigation = null;
            }
          } else {
            // User cancelled - do nothing
            this.pendingNavigation = null;
          }
        },
      }
    );

    return false;
  }

  /**
   * Get count of dirty forms (for debugging)
   */
  public getDirtyCount(): number {
    return this.dirtyForms.size;
  }

  /**
   * Get list of dirty form IDs (for debugging)
   */
  public getDirtyForms(): string[] {
    return Array.from(this.dirtyForms);
  }
}
