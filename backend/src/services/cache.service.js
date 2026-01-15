const { LRUCache } = require('lru-cache');
const hash = require('object-hash');

// Cache Service (In-Memory LRU)

class CacheService {
    constructor() {
        this.config = {
            ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '300', 10),
            maxSize: parseInt(process.env.CACHE_MAX_SIZE || '100', 10),
        };

        this.cache = new LRUCache({
            max: this.config.maxSize,
            ttl: this.config.ttlSeconds * 1000,
            updateAgeOnGet: true,
        });

        console.log(`[Cache] Initialized with TTL=${this.config.ttlSeconds}s, maxSize=${this.config.maxSize}`);
    }

    generateKey(request) {
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

    get(request) {
        const key = this.generateKey(request);
        const entry = this.cache.get(key);

        if (entry) {
            console.log(`[Cache] HIT for key ${key.substring(0, 8)}...`);
            return {
                data: entry.data,
                totalRows: entry.totalRows,
                timestamp: entry.timestamp,
                cacheAgeMs: Date.now() - entry.timestamp
            };
        }

        console.log(`[Cache] MISS for key ${key.substring(0, 8)}...`);
        return null;
    }

    set(request, data, totalRows) {
        const key = this.generateKey(request);

        this.cache.set(key, {
            data,
            totalRows,
            timestamp: Date.now(),
        });

        console.log(`[Cache] SET key ${key.substring(0, 8)}... (${data.length} rows, total: ${totalRows})`);
    }

    clear() {
        this.cache.clear();
        console.log('[Cache] Cleared all entries');
    }

    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.config.maxSize,
            ttlSeconds: this.config.ttlSeconds,
        };
    }
}

const cacheService = new CacheService();
module.exports = { cacheService };
