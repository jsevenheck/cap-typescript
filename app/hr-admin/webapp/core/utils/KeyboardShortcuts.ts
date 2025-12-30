/**
 * Keyboard Shortcuts Utility
 *
 * Provides keyboard shortcut handling following SAP Fiori Design Guidelines.
 * Implements common shortcuts for productivity actions like:
 * - Ctrl+N / Cmd+N: Create new item
 * - Ctrl+E / Cmd+E: Edit selected item
 * - Ctrl+S / Cmd+S: Save current item
 * - Delete: Delete selected item
 * - Escape: Cancel current operation
 * - F5: Refresh
 *
 * @see https://experience.sap.com/fiori-design-web/keyboard-interaction/
 */

export interface ShortcutDefinition {
  /** Shortcut key code (e.g., 'KeyN', 'KeyE', 'Delete') */
  key: string;
  /** Whether Ctrl (Windows) or Cmd (Mac) modifier is required */
  ctrlOrCmd?: boolean;
  /** Whether Shift modifier is required */
  shift?: boolean;
  /** Whether Alt modifier is required */
  alt?: boolean;
  /** Handler function to execute when shortcut is triggered */
  handler: () => void;
  /** Description for accessibility and help dialogs */
  description?: string;
  /** Whether this shortcut should work when a dialog is open */
  allowInDialog?: boolean;
}

export interface ShortcutGroup {
  /** Group name for organization */
  name: string;
  /** Shortcuts in this group */
  shortcuts: ShortcutDefinition[];
  /** Whether this group is currently active */
  enabled: boolean;
}

/**
 * Keyboard Shortcuts Manager
 *
 * Manages keyboard shortcuts for a UI5 application.
 * Supports context-aware shortcuts that can be enabled/disabled
 * based on the current page or dialog state.
 */
export class KeyboardShortcutManager {
  private shortcuts: Map<string, ShortcutDefinition[]> = new Map();
  private boundHandler: ((event: KeyboardEvent) => void) | null = null;
  private enabled: boolean = true;
  private dialogOpen: boolean = false;

  /**
   * Create a new KeyboardShortcutManager instance.
   */
  constructor() {
    this.boundHandler = this.handleKeyDown.bind(this);
  }

  /**
   * Generate a unique key for a shortcut combination.
   */
  private getShortcutKey(
    key: string,
    ctrlOrCmd?: boolean,
    shift?: boolean,
    alt?: boolean
  ): string {
    const parts: string[] = [];
    if (ctrlOrCmd) parts.push("ctrl");
    if (shift) parts.push("shift");
    if (alt) parts.push("alt");
    parts.push(key.toLowerCase());
    return parts.join("+");
  }

  /**
   * Register a keyboard shortcut.
   *
   * @param definition - The shortcut definition to register
   */
  public register(definition: ShortcutDefinition): void {
    const key = this.getShortcutKey(
      definition.key,
      definition.ctrlOrCmd,
      definition.shift,
      definition.alt
    );

    const existing = this.shortcuts.get(key) || [];
    existing.push(definition);
    this.shortcuts.set(key, existing);
  }

  /**
   * Register multiple shortcuts at once.
   *
   * @param definitions - Array of shortcut definitions to register
   */
  public registerAll(definitions: ShortcutDefinition[]): void {
    definitions.forEach((def) => this.register(def));
  }

  /**
   * Unregister all shortcuts for a specific key combination.
   *
   * @param key - The key code
   * @param ctrlOrCmd - Whether Ctrl/Cmd modifier was required
   * @param shift - Whether Shift modifier was required
   * @param alt - Whether Alt modifier was required
   */
  public unregister(
    key: string,
    ctrlOrCmd?: boolean,
    shift?: boolean,
    alt?: boolean
  ): void {
    const shortcutKey = this.getShortcutKey(key, ctrlOrCmd, shift, alt);
    this.shortcuts.delete(shortcutKey);
  }

  /**
   * Clear all registered shortcuts.
   */
  public clear(): void {
    this.shortcuts.clear();
  }

  /**
   * Start listening for keyboard events.
   */
  public attach(): void {
    if (this.boundHandler) {
      document.addEventListener("keydown", this.boundHandler);
    }
  }

  /**
   * Stop listening for keyboard events.
   */
  public detach(): void {
    if (this.boundHandler) {
      document.removeEventListener("keydown", this.boundHandler);
    }
  }

  /**
   * Enable or disable the shortcut manager.
   *
   * @param enabled - Whether shortcuts should be active
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Set whether a dialog is currently open.
   * Most shortcuts are disabled when a dialog is open.
   *
   * @param open - Whether a dialog is open
   */
  public setDialogOpen(open: boolean): void {
    this.dialogOpen = open;
  }

  /**
   * Handle keydown events and trigger matching shortcuts.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.enabled) {
      return;
    }

    // Skip if user is typing in an input field (unless it's a navigation key)
    const target = event.target as HTMLElement;
    const isInputField =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    // Allow Escape in input fields, but block other shortcuts
    if (isInputField && event.code !== "Escape") {
      return;
    }

    // Check if Ctrl (Windows/Linux) or Cmd (Mac) is pressed
    const ctrlOrCmd = event.ctrlKey || event.metaKey;

    const shortcutKey = this.getShortcutKey(
      event.code,
      ctrlOrCmd,
      event.shiftKey,
      event.altKey
    );

    const definitions = this.shortcuts.get(shortcutKey);
    if (!definitions || definitions.length === 0) {
      return;
    }

    // Find a matching shortcut that can be executed
    for (const definition of definitions) {
      // Skip if dialog is open and shortcut doesn't allow it
      if (this.dialogOpen && !definition.allowInDialog) {
        continue;
      }

      // Prevent default browser behavior and execute handler
      event.preventDefault();
      event.stopPropagation();
      definition.handler();
      return;
    }
  }

  /**
   * Get all registered shortcuts for display in a help dialog.
   *
   * @returns Array of shortcut descriptions
   */
  public getShortcutList(): Array<{ combo: string; description: string }> {
    const list: Array<{ combo: string; description: string }> = [];

    this.shortcuts.forEach((definitions, key) => {
      definitions.forEach((def) => {
        if (def.description) {
          const combo = this.formatShortcutCombo(
            def.key,
            def.ctrlOrCmd,
            def.shift,
            def.alt
          );
          list.push({ combo, description: def.description });
        }
      });
    });

    return list;
  }

  /**
   * Format a shortcut combination for display.
   */
  private formatShortcutCombo(
    key: string,
    ctrlOrCmd?: boolean,
    shift?: boolean,
    alt?: boolean
  ): string {
    const isMac =
      typeof navigator !== "undefined" &&
      navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const parts: string[] = [];

    if (ctrlOrCmd) {
      parts.push(isMac ? "⌘" : "Ctrl");
    }
    if (shift) {
      parts.push(isMac ? "⇧" : "Shift");
    }
    if (alt) {
      parts.push(isMac ? "⌥" : "Alt");
    }

    // Format the key nicely
    let keyDisplay = key.replace("Key", "").replace("Digit", "");
    if (key === "Delete") keyDisplay = isMac ? "⌫" : "Del";
    if (key === "Escape") keyDisplay = "Esc";
    if (key === "F5") keyDisplay = "F5";

    parts.push(keyDisplay);

    return parts.join(isMac ? "" : "+");
  }
}

/**
 * Create default shortcuts for a typical CRUD application.
 *
 * @param handlers - Object containing handler functions for each action
 * @returns Array of shortcut definitions
 */
export function createDefaultShortcuts(handlers: {
  onAdd?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  onRefresh?: () => void;
}): ShortcutDefinition[] {
  const shortcuts: ShortcutDefinition[] = [];

  if (handlers.onAdd) {
    shortcuts.push({
      key: "KeyN",
      ctrlOrCmd: true,
      handler: handlers.onAdd,
      description: "Create new item",
    });
  }

  if (handlers.onEdit) {
    shortcuts.push({
      key: "KeyE",
      ctrlOrCmd: true,
      handler: handlers.onEdit,
      description: "Edit selected item",
    });
  }

  if (handlers.onDelete) {
    shortcuts.push({
      key: "Delete",
      handler: handlers.onDelete,
      description: "Delete selected item",
    });
  }

  if (handlers.onSave) {
    shortcuts.push({
      key: "KeyS",
      ctrlOrCmd: true,
      handler: handlers.onSave,
      description: "Save",
      allowInDialog: true,
    });
  }

  if (handlers.onCancel) {
    shortcuts.push({
      key: "Escape",
      handler: handlers.onCancel,
      description: "Cancel",
      allowInDialog: true,
    });
  }

  if (handlers.onRefresh) {
    shortcuts.push({
      key: "F5",
      handler: handlers.onRefresh,
      description: "Refresh",
    });
  }

  return shortcuts;
}

// Export a singleton instance for convenience
export const globalShortcuts = new KeyboardShortcutManager();
