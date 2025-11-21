/**
 * CacheService - Browser storage caching with TTL support
 *
 * Provides a type-safe caching layer over localStorage and sessionStorage
 * with automatic expiration, namespacing, and error handling.
 *
 * Features:
 * - TTL (time-to-live) with automatic expiration
 * - Support for localStorage (persistent) and sessionStorage (session-only)
 * - Namespace support to avoid key conflicts
 * - Type-safe API with generics
 * - Automatic cleanup of expired entries
 * - Storage quota error handling
 *
 * @example
 * ```typescript
 * const cache = CacheService.getInstance();
 *
 * // Store data with 1 hour TTL
 * cache.set('countries', countryData, 3600000);
 *
 * // Retrieve data (returns undefined if expired or not found)
 * const countries = cache.get<Country[]>('countries');
 *
 * // Clear all cached data
 * cache.clear();
 * ```
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export type StorageType = 'localStorage' | 'sessionStorage';

export interface CacheOptions {
  /** Storage type - localStorage (persistent) or sessionStorage (session-only) */
  storage?: StorageType;
  /** Cache key prefix for namespacing */
  namespace?: string;
}

export default class CacheService {
  private static instance: CacheService;
  private readonly namespace: string;
  private readonly storage: Storage;
  private readonly storageType: StorageType;

  // Default TTL values (in milliseconds)
  public static readonly TTL_1_HOUR = 60 * 60 * 1000;
  public static readonly TTL_4_HOURS = 4 * 60 * 60 * 1000;
  public static readonly TTL_8_HOURS = 8 * 60 * 60 * 1000;
  public static readonly TTL_24_HOURS = 24 * 60 * 60 * 1000;
  public static readonly TTL_7_DAYS = 7 * 24 * 60 * 60 * 1000;

  private constructor(options: CacheOptions = {}) {
    this.namespace = options.namespace || 'hrapp';
    this.storageType = options.storage || 'sessionStorage';
    this.storage = this.storageType === 'localStorage' ? window.localStorage : window.sessionStorage;
  }

  /**
   * Get singleton instance with default configuration
   * For sessionStorage (cleared on tab close)
   */
  public static getInstance(options?: CacheOptions): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService(options);
    }
    return CacheService.instance;
  }

  /**
   * Create a new cache instance with custom configuration
   * Useful for creating separate caches (e.g., persistent vs session)
   */
  public static create(options: CacheOptions): CacheService {
    return new CacheService(options);
  }

  /**
   * Store a value in cache with TTL
   * @param key Cache key (will be namespaced automatically)
   * @param value Value to cache (will be JSON serialized)
   * @param ttl Time-to-live in milliseconds (default: 1 hour)
   * @returns true if stored successfully, false on error
   */
  public set<T>(key: string, value: T, ttl: number = CacheService.TTL_1_HOUR): boolean {
    try {
      const entry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
        ttl,
      };

      const namespacedKey = this.getNamespacedKey(key);
      this.storage.setItem(namespacedKey, JSON.stringify(entry));
      return true;
    } catch (error) {
      // Handle storage quota exceeded errors
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('Cache storage quota exceeded, clearing old entries');
        this.clearExpired();

        // Retry once after cleanup
        try {
          const entry: CacheEntry<T> = {
            value,
            timestamp: Date.now(),
            ttl,
          };
          const namespacedKey = this.getNamespacedKey(key);
          this.storage.setItem(namespacedKey, JSON.stringify(entry));
          return true;
        } catch (retryError) {
          console.error('Failed to cache after cleanup:', retryError);
          return false;
        }
      }

      console.error('Failed to cache value:', error);
      return false;
    }
  }

  /**
   * Retrieve a value from cache
   * @param key Cache key
   * @returns Cached value or undefined if not found/expired
   */
  public get<T>(key: string): T | undefined {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const item = this.storage.getItem(namespacedKey);

      if (!item) {
        return undefined;
      }

      const entry: CacheEntry<T> = JSON.parse(item);
      const now = Date.now();
      const age = now - entry.timestamp;

      // Check if expired
      if (age > entry.ttl) {
        this.remove(key);
        return undefined;
      }

      return entry.value;
    } catch (error) {
      console.error('Failed to retrieve cached value:', error);
      return undefined;
    }
  }

  /**
   * Check if a key exists and is not expired
   * @param key Cache key
   * @returns true if exists and valid, false otherwise
   */
  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Remove a specific key from cache
   * @param key Cache key to remove
   */
  public remove(key: string): void {
    const namespacedKey = this.getNamespacedKey(key);
    this.storage.removeItem(namespacedKey);
  }

  /**
   * Clear all cached entries with this namespace
   */
  public clear(): void {
    const keysToRemove: string[] = [];

    // Find all keys with our namespace
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(`${this.namespace}:`)) {
        keysToRemove.push(key);
      }
    }

    // Remove all namespaced keys
    keysToRemove.forEach(key => this.storage.removeItem(key));
  }

  /**
   * Clear only expired entries
   * Useful for manual cleanup to free up storage space
   */
  public clearExpired(): void {
    const keysToRemove: string[] = [];
    const now = Date.now();

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(`${this.namespace}:`)) {
        try {
          const item = this.storage.getItem(key);
          if (item) {
            const entry: CacheEntry<unknown> = JSON.parse(item);
            const age = now - entry.timestamp;
            if (age > entry.ttl) {
              keysToRemove.push(key);
            }
          }
        } catch (error) {
          // If parsing fails, remove the corrupted entry
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => this.storage.removeItem(key));

    if (keysToRemove.length > 0) {
      console.log(`Cleared ${keysToRemove.length} expired cache entries`);
    }
  }

  /**
   * Get cache statistics for monitoring
   * @returns Object with cache size and entry count
   */
  public getStats(): { entryCount: number; sizeKB: number; storageType: string } {
    let entryCount = 0;
    let totalSize = 0;

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(`${this.namespace}:`)) {
        entryCount++;
        const item = this.storage.getItem(key);
        if (item) {
          totalSize += key.length + item.length;
        }
      }
    }

    return {
      entryCount,
      sizeKB: Math.round(totalSize / 1024 * 100) / 100,
      storageType: this.storageType,
    };
  }

  /**
   * Get namespaced key
   * @param key Original key
   * @returns Namespaced key
   */
  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }
}
