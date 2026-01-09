import { LRUCache } from 'lru-cache';
import hash from 'object-hash';
import { QueryRequest, CacheConfig } from '../types/data.types';

// =============================================================================
// Cache Service (In-Memory LRU)
// =============================================================================

interface CacheEntry<T> {
    data: T;
    totalRows: number;
    timestamp: number;
}

class CacheService {
    private cache: LRUCache<string, CacheEntry<unknown>>;
    private config: CacheConfig;

    constructor() {
        this.config = {
            ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '300', 10),
            maxSize: parseInt(process.env.CACHE_MAX_SIZE || '100', 10),
        };

        this.cache = new LRUCache<string, CacheEntry<unknown>>({
            max: this.config.maxSize,
            ttl: this.config.ttlSeconds * 1000,
            updateAgeOnGet: true,
        });

        console.log(`[Cache] Initialized with TTL=${this.config.ttlSeconds}s, maxSize=${this.config.maxSize}`);
    }

    /**
     * Generate a unique cache key from query request
     */
    generateKey(request: QueryRequest): string {
        // Create a normalized version for consistent hashing
        const normalized = {
            dimensions: [...request.dimensions].sort(),
            metrics: [...request.metrics].sort(),
            filters: [...request.filters].sort((a, b) => a.column.localeCompare(b.column)),
            sort: request.sort,
            offset: request.offset,
            limit: request.limit,
            comparison: request.comparison,
            search: request.search,
        };

        return hash(normalized);
    }

    /**
     * Get cached result if available
     */
    get<T>(request: QueryRequest): { data: T[]; totalRows: number } | null {
        const key = this.generateKey(request);
        const entry = this.cache.get(key) as CacheEntry<T[]> | undefined;

        if (entry) {
            console.log(`[Cache] HIT for key ${key.substring(0, 8)}...`);
            return { data: entry.data, totalRows: entry.totalRows };
        }

        console.log(`[Cache] MISS for key ${key.substring(0, 8)}...`);
        return null;
    }

    /**
     * Store result in cache
     */
    set<T>(request: QueryRequest, data: T[], totalRows: number): void {
        const key = this.generateKey(request);

        this.cache.set(key, {
            data,
            totalRows,
            timestamp: Date.now(),
        });

        console.log(`[Cache] SET key ${key.substring(0, 8)}... (${data.length} rows, total: ${totalRows})`);
    }

    /**
     * Invalidate all cache entries
     */
    clear(): void {
        this.cache.clear();
        console.log('[Cache] Cleared all entries');
    }

    /**
     * Get cache statistics
     */
    getStats(): { size: number; maxSize: number; ttlSeconds: number } {
        return {
            size: this.cache.size,
            maxSize: this.config.maxSize,
            ttlSeconds: this.config.ttlSeconds,
        };
    }
}

// Export singleton instance
export const cacheService = new CacheService();
