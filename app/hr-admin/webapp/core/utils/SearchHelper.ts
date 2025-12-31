import List from "sap/m/List";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";

/**
 * Configuration for entity search
 */
export interface SearchConfig {
  /** ID of the list control to filter */
  listId: string;
  /** Array of field names to search in */
  searchableFields: string[];
  /** Debounce delay in milliseconds (default: 300) */
  debounceDelay?: number;
}

/**
 * Predefined search configurations for common entities
 */
export const SEARCH_CONFIGS = {
  employees: {
    listId: "employeesList",
    searchableFields: ["firstName", "lastName", "email", "employeeId"],
  } as SearchConfig,
  costCenters: {
    listId: "costCentersList",
    searchableFields: ["code", "name", "description"],
  } as SearchConfig,
  locations: {
    listId: "locationsList",
    searchableFields: ["city", "street", "zipCode", "country_code"],
  } as SearchConfig,
};

/**
 * Generic search helper for UI5 list filtering.
 * Provides debounced search functionality with OData Contains filters.
 */
export class SearchHelper {
  private debounceTimeoutId?: number;
  private readonly debounceDelay: number;
  private readonly searchableFields: string[];
  private readonly listId: string;
  private readonly getListById: (id: string) => List | undefined;

  /**
   * Creates a new SearchHelper instance
   * @param config - Search configuration
   * @param getListById - Function to retrieve the list control by ID (typically controller's byId method)
   */
  constructor(
    config: SearchConfig,
    getListById: (id: string) => List | undefined,
  ) {
    this.listId = config.listId;
    this.searchableFields = config.searchableFields;
    this.debounceDelay = config.debounceDelay ?? 300;
    this.getListById = getListById;
  }

  /**
   * Handle search submit (Enter key).
   * Applies filter immediately without debouncing.
   * @param query - Search query string
   */
  public onSearch(query: string): void {
    this.applyFilter(query);
  }

  /**
   * Handle live search change (as user types).
   * Applies filter with debouncing to avoid excessive OData requests.
   * @param query - Search query string
   */
  public onLiveChange(query: string): void {
    // Clear any pending debounce timeout
    if (this.debounceTimeoutId !== undefined) {
      clearTimeout(this.debounceTimeoutId);
    }

    // Debounce search to avoid excessive requests
    this.debounceTimeoutId = setTimeout(() => {
      this.applyFilter(query);
      this.debounceTimeoutId = undefined;
    }, this.debounceDelay) as unknown as number;
  }

  /**
   * Clear search filter from the list
   */
  public clearFilter(): void {
    const list = this.getListById(this.listId);
    if (!list) return;

    const binding = list.getBinding("items") as ODataListBinding;
    if (!binding) return;

    binding.filter([]);
  }

  /**
   * Clear any pending debounce timeout.
   * Should be called when the controller is destroyed.
   */
  public destroy(): void {
    if (this.debounceTimeoutId !== undefined) {
      clearTimeout(this.debounceTimeoutId);
      this.debounceTimeoutId = undefined;
    }
  }

  /**
   * Apply filter to the list based on search query.
   * Uses OData V4 Contains filter (case-insensitive by default).
   * @param query - Search query string
   */
  private applyFilter(query: string): void {
    const list = this.getListById(this.listId);
    if (!list) return;

    const binding = list.getBinding("items") as ODataListBinding;
    if (!binding) return;

    if (!query || query.trim().length === 0) {
      // Clear filters when search is empty
      binding.filter([]);
      return;
    }

    const searchValue = query.trim();

    // Create filters for each searchable field
    // In OData V4, FilterOperator.Contains is inherently case-insensitive
    const filters = this.searchableFields.map(
      (field) => new Filter(field, FilterOperator.Contains, searchValue),
    );

    // Combine with OR logic - match any of the fields
    const combinedFilter = new Filter({
      filters: filters,
      and: false,
    });

    binding.filter([combinedFilter]);
  }
}
