import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import CacheService from "./cache.service";

/**
 * CacheManager - Coordinates caching across OData model and browser storage
 *
 * Provides centralized cache management for the application, coordinating
 * between OData V4 model cache and browser storage (CacheService).
 *
 * Features:
 * - Unified cache invalidation for OData + browser storage
 * - Selective cache clearing (by entity type)
 * - Cache statistics and monitoring
 * - Integration with OData model refresh
 *
 * @example
 * ```typescript
 * const cacheManager = new CacheManager(odataModel);
 *
 * // Clear all caches
 * cacheManager.clearAll();
 *
 * // Clear specific entity cache
 * cacheManager.clearEntity('Clients');
 *
 * // Refresh OData model bindings
 * cacheManager.refreshModel();
 * ```
 */
export default class CacheManager {
  private readonly odataModel: ODataModel;
  private readonly browserCache: CacheService;

  /**
   * Create a cache manager instance
   * @param odataModel OData V4 model instance
   * @param browserCache Optional custom cache service (defaults to singleton instance)
   */
  constructor(odataModel: ODataModel, browserCache?: CacheService) {
    this.odataModel = odataModel;
    this.browserCache = browserCache || CacheService.getInstance();
  }

  /**
   * Clear all caches (OData model + browser storage)
   * Use this for global refresh or user-initiated cache clear
   */
  public clearAll(): void {
    console.log('Clearing all caches (OData model + browser storage)');

    // Clear browser storage cache
    this.browserCache.clear();

    // Reset the OData model to clear all bindings
    // Note: This will trigger refresh of all active bindings
    this.odataModel.resetChanges();

    console.log('All caches cleared successfully');
  }

  /**
   * Clear only expired browser cache entries
   * Useful for periodic cleanup without disrupting active caches
   */
  public clearExpired(): void {
    this.browserCache.clearExpired();
  }

  /**
   * Refresh OData model by refreshing all active bindings
   * This will reload data from server while respecting model cache settings
   */
  public refreshModel(): void {
    console.log('Refreshing OData model bindings');

    // Get all bindings and refresh them
    const bindings = this.odataModel.getAllBindings();
    bindings.forEach((binding: any) => {
      if (binding.refresh && typeof binding.refresh === 'function') {
        binding.refresh();
      }
    });
  }

  /**
   * Clear cache for a specific entity type
   * @param entityType Entity set name (e.g., 'Clients', 'Employees')
   */
  public clearEntity(entityType: string): void {
    console.log(`Clearing cache for entity: ${entityType}`);

    // Clear browser storage entries for this entity
    this.browserCache.remove(entityType);
    this.browserCache.remove(`${entityType}:list`);
    this.browserCache.remove(`${entityType}:metadata`);

    // Refresh bindings for this entity
    const bindings = this.odataModel.getAllBindings();
    bindings.forEach((binding: any) => {
      if (binding.getPath && binding.getPath().includes(entityType)) {
        if (binding.refresh && typeof binding.refresh === 'function') {
          binding.refresh();
        }
      }
    });
  }

  /**
   * Get combined cache statistics
   * @returns Cache statistics from both browser storage and OData model
   */
  public getStats(): {
    browserCache: ReturnType<typeof this.browserCache.getStats>;
    modelStats: {
      pendingChanges: boolean;
      hasPendingRequests: boolean;
    };
  } {
    return {
      browserCache: this.browserCache.getStats(),
      modelStats: {
        pendingChanges: this.odataModel.hasPendingChanges(),
        hasPendingRequests: this.odataModel.hasPendingRequests ? this.odataModel.hasPendingRequests() : false,
      },
    };
  }

  /**
   * Store reference data in browser cache
   * Use for relatively static data like countries, status options, etc.
   *
   * @param key Cache key
   * @param data Data to cache
   * @param ttl Time-to-live in milliseconds (default: 24 hours)
   * @returns true if stored successfully
   */
  public cacheReferenceData<T>(key: string, data: T, ttl: number = CacheService.TTL_24_HOURS): boolean {
    return this.browserCache.set(key, data, ttl);
  }

  /**
   * Retrieve reference data from browser cache
   * @param key Cache key
   * @returns Cached data or undefined if not found/expired
   */
  public getReferenceData<T>(key: string): T | undefined {
    return this.browserCache.get<T>(key);
  }

  /**
   * Check if reference data exists in cache
   * @param key Cache key
   * @returns true if exists and not expired
   */
  public hasReferenceData(key: string): boolean {
    return this.browserCache.has(key);
  }
}
