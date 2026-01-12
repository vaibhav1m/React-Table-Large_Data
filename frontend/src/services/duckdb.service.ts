/**
 * DuckDB-WASM Service
 * 
 * Provides instant in-browser SQL queries using DuckDB WebAssembly.
 * All data is loaded once from the backend, then queried locally for
 * instant sorting, filtering, and aggregation.
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdb_wasm_next from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';

// =============================================================================
// Types
// =============================================================================

export interface DuckDBQueryResult {
    columns: string[];
    columnTypes: string[];
    data: (string | number | null)[][];
    totalRows: number;
    queryTimeMs: number;
}

export interface DuckDBFilter {
    column: string;
    operator: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'like' | 'ilike';
    value: unknown;
}

export interface DuckDBSort {
    column: string;
    direction: 'asc' | 'desc';
}

// =============================================================================
// DuckDB Instance Management
// =============================================================================

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;
let tableColumns: { name: string; type: string }[] = [];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Escape a string value for SQL
 */
function escapeString(value: string): string {
    return value.replace(/'/g, "''");
}

/**
 * Build WHERE clause from filters
 */
function buildWhereClause(filters: DuckDBFilter[]): string {
    if (filters.length === 0) return '';

    const conditions = filters.map(filter => {
        const col = `"${filter.column}"`;

        switch (filter.operator) {
            case 'eq':
                if (filter.value === null) return `${col} IS NULL`;
                return typeof filter.value === 'string'
                    ? `${col} = '${escapeString(filter.value)}'`
                    : `${col} = ${filter.value}`;
            case 'neq':
                if (filter.value === null) return `${col} IS NOT NULL`;
                return typeof filter.value === 'string'
                    ? `${col} != '${escapeString(filter.value)}'`
                    : `${col} != ${filter.value}`;
            case 'gt':
                return `${col} > ${filter.value}`;
            case 'gte':
                return `${col} >= ${filter.value}`;
            case 'lt':
                return `${col} < ${filter.value}`;
            case 'lte':
                return `${col} <= ${filter.value}`;
            case 'like':
                return `${col} LIKE '${escapeString(String(filter.value))}'`;
            case 'ilike':
                return `LOWER(${col}) LIKE LOWER('${escapeString(String(filter.value))}')`;
            case 'in':
                if (Array.isArray(filter.value)) {
                    const values = filter.value.map(v =>
                        typeof v === 'string' ? `'${escapeString(v)}'` : v
                    ).join(', ');
                    return `${col} IN (${values})`;
                }
                return '1=1';
            case 'nin':
                if (Array.isArray(filter.value)) {
                    const values = filter.value.map(v =>
                        typeof v === 'string' ? `'${escapeString(v)}'` : v
                    ).join(', ');
                    return `${col} NOT IN (${values})`;
                }
                return '1=1';
            case 'between':
                if (Array.isArray(filter.value) && filter.value.length === 2) {
                    return `${col} BETWEEN ${filter.value[0]} AND ${filter.value[1]}`;
                }
                return '1=1';
            default:
                return '1=1';
        }
    });

    return `WHERE ${conditions.join(' AND ')}`;
}

// =============================================================================
// DuckDB Service
// =============================================================================

export const duckdbService = {
    /**
     * Initialize DuckDB-WASM
     */
    async initialize(): Promise<void> {
        if (isInitialized) return;
        if (initPromise) return initPromise;

        initPromise = (async () => {
            console.log('[DuckDB] Initializing...');
            const startTime = performance.now();

            try {
                // Configure DuckDB bundles
                const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
                    mvp: {
                        mainModule: duckdb_wasm,
                        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js', import.meta.url).href,
                    },
                    eh: {
                        mainModule: duckdb_wasm_next,
                        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url).href,
                    },
                };

                // Select the best bundle for the browser
                const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);

                // Create worker and instantiate DuckDB
                const worker = new Worker(bundle.mainWorker!);
                const logger = new duckdb.ConsoleLogger();
                db = new duckdb.AsyncDuckDB(logger, worker);

                await db.instantiate(bundle.mainModule);
                conn = await db.connect();

                isInitialized = true;
                console.log(`[DuckDB] Initialized in ${(performance.now() - startTime).toFixed(0)}ms`);
            } catch (error) {
                console.error('[DuckDB] Initialization failed:', error);
                throw error;
            }
        })();

        return initPromise;
    },

    /**
     * Load data into DuckDB table
     * @param columns Column names
     * @param columnTypes Column types (from backend)
     * @param data Row data as 2D array
     */
    async loadData(
        columns: string[],
        columnTypes: string[],
        data: (string | number | null)[][]
    ): Promise<void> {
        if (!conn) throw new Error('DuckDB not initialized');

        console.log(`[DuckDB] Loading ${data.length} rows...`);
        const startTime = performance.now();

        // Store column info for later use
        tableColumns = columns.map((name, i) => ({
            name,
            type: columnTypes[i] || 'VARCHAR',
        }));

        // Drop existing table if any
        await conn.query('DROP TABLE IF EXISTS sales_data');

        // Create table with proper types
        const columnDefs = columns.map((col, i) => {
            const backendType = columnTypes[i]?.toLowerCase() || 'varchar';
            let duckType = 'VARCHAR';

            if (backendType.includes('int') || backendType.includes('integer')) {
                duckType = 'BIGINT';
            } else if (backendType.includes('double') || backendType.includes('float') || backendType.includes('numeric') || backendType.includes('decimal') || backendType.includes('currency')) {
                duckType = 'DOUBLE';
            } else if (backendType.includes('bool')) {
                duckType = 'BOOLEAN';
            } else if (backendType.includes('date')) {
                duckType = 'DATE';
            } else if (backendType.includes('timestamp')) {
                duckType = 'TIMESTAMP';
            }

            return `"${col}" ${duckType}`;
        });

        await conn.query(`CREATE TABLE sales_data (${columnDefs.join(', ')})`);

        // Insert data in batches for performance
        const BATCH_SIZE = 1000;
        for (let i = 0; i < data.length; i += BATCH_SIZE) {
            const batch = data.slice(i, i + BATCH_SIZE);

            // Build INSERT statement
            const values = batch.map(row => {
                const rowValues = row.map((val, colIdx) => {
                    if (val === null || val === undefined) return 'NULL';
                    const colType = columnTypes[colIdx]?.toLowerCase() || 'varchar';
                    if (colType.includes('int') || colType.includes('double') || colType.includes('float') || colType.includes('numeric') || colType.includes('decimal') || colType.includes('currency')) {
                        return val;
                    }
                    return `'${escapeString(String(val))}'`;
                });
                return `(${rowValues.join(', ')})`;
            }).join(', ');

            await conn.query(`INSERT INTO sales_data VALUES ${values}`);
        }

        console.log(`[DuckDB] Loaded ${data.length} rows in ${(performance.now() - startTime).toFixed(0)}ms`);
    },

    /**
     * Query data with filtering, sorting, and pagination
     */
    async query(params: {
        dimensions: string[];
        metrics: string[];
        filters?: DuckDBFilter[];
        sort?: DuckDBSort[];
        limit?: number;
        offset?: number;
        search?: string;
    }): Promise<DuckDBQueryResult> {
        if (!conn) throw new Error('DuckDB not initialized');

        const startTime = performance.now();
        const { dimensions, metrics, filters = [], sort = [], limit = 500, offset = 0, search } = params;

        // Build column list
        const allColumns = [...dimensions, ...metrics];
        const selectCols = allColumns.map(c => `"${c}"`).join(', ');

        // Build search filter if provided
        const searchFilters: DuckDBFilter[] = [];
        if (search && search.trim()) {
            // Search across all dimension columns
            dimensions.forEach(dim => {
                searchFilters.push({
                    column: dim,
                    operator: 'ilike',
                    value: `%${search}%`,
                });
            });
        }

        // Combine filters (search uses OR, regular filters use AND)
        let whereClause = '';
        if (filters.length > 0 || searchFilters.length > 0) {
            const filterConditions = buildWhereClause(filters).replace('WHERE ', '');
            const searchConditions = searchFilters.length > 0
                ? `(${searchFilters.map(f => {
                    const col = `"${f.column}"`;
                    return `LOWER(CAST(${col} AS VARCHAR)) LIKE LOWER('${escapeString(String(f.value))}')`;
                }).join(' OR ')})`
                : '';

            if (filterConditions && searchConditions) {
                whereClause = `WHERE ${filterConditions} AND ${searchConditions}`;
            } else if (filterConditions) {
                whereClause = `WHERE ${filterConditions}`;
            } else if (searchConditions) {
                whereClause = `WHERE ${searchConditions}`;
            }
        }

        // Build ORDER BY - include dimension columns for proper grouping
        let orderByClause = '';
        if (sort.length > 0) {
            // First sort by dimensions for grouping, then by specified sort
            const dimensionSort = dimensions.map(d => `"${d}" ASC`);
            const userSort = sort.map(s => `"${s.column}" ${s.direction.toUpperCase()}`);
            orderByClause = `ORDER BY ${[...dimensionSort, ...userSort].join(', ')}`;
        } else {
            // Default: sort by dimensions for grouping
            orderByClause = `ORDER BY ${dimensions.map(d => `"${d}" ASC`).join(', ')}`;
        }

        // Get total count first
        const countQuery = `SELECT COUNT(*) as cnt FROM sales_data ${whereClause}`;
        const countResult = await conn.query(countQuery);
        const totalRows = Number(countResult.toArray()[0]?.cnt ?? 0);

        // Main query with pagination
        const mainQuery = `
            SELECT ${selectCols}
            FROM sales_data
            ${whereClause}
            ${orderByClause}
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const result = await conn.query(mainQuery);
        const rows = result.toArray();

        // Convert to our format
        const data: (string | number | null)[][] = rows.map(row => {
            return allColumns.map(col => {
                const val = row[col];
                if (val === null || val === undefined) return null;
                if (typeof val === 'bigint') return Number(val);
                return val as string | number;
            });
        });

        // Get column types
        const columnTypes = allColumns.map(col => {
            const colInfo = tableColumns.find(c => c.name === col);
            return colInfo?.type || 'VARCHAR';
        });

        const queryTimeMs = performance.now() - startTime;
        console.log(`[DuckDB] Query returned ${data.length} rows in ${queryTimeMs.toFixed(1)}ms`);

        return {
            columns: allColumns,
            columnTypes,
            data,
            totalRows,
            queryTimeMs,
        };
    },

    /**
     * Get distinct values for a column (for filters)
     */
    async getFilterValues(column: string): Promise<string[]> {
        if (!conn) throw new Error('DuckDB not initialized');

        const result = await conn.query(`
            SELECT DISTINCT "${column}" as value
            FROM sales_data
            WHERE "${column}" IS NOT NULL
            ORDER BY "${column}"
            LIMIT 1000
        `);

        return result.toArray().map(row => String(row.value));
    },

    /**
     * Search for autocomplete results
     */
    async search(query: string, columns: string[]): Promise<{ column: string; value: string }[]> {
        if (!conn || !query.trim()) return [];

        const searchPattern = `%${escapeString(query.toLowerCase())}%`;
        const results: { column: string; value: string }[] = [];

        for (const col of columns) {
            const result = await conn.query(`
                SELECT DISTINCT "${col}" as value
                FROM sales_data
                WHERE LOWER(CAST("${col}" AS VARCHAR)) LIKE '${searchPattern}'
                LIMIT 10
            `);

            result.toArray().forEach(row => {
                if (row.value != null) {
                    results.push({ column: col, value: String(row.value) });
                }
            });
        }

        return results.slice(0, 50);
    },

    /**
     * Check if DuckDB is initialized and has data
     */
    isReady(): boolean {
        return isInitialized && conn !== null;
    },

    /**
     * Get the count of rows in the table
     */
    async getRowCount(): Promise<number> {
        if (!conn) return 0;
        const result = await conn.query('SELECT COUNT(*) as cnt FROM sales_data');
        return Number(result.toArray()[0]?.cnt ?? 0);
    },

    /**
     * Cleanup DuckDB resources
     */
    async destroy(): Promise<void> {
        if (conn) {
            await conn.close();
            conn = null;
        }
        if (db) {
            await db.terminate();
            db = null;
        }
        isInitialized = false;
        initPromise = null;
        tableColumns = [];
        console.log('[DuckDB] Destroyed');
    },
};

export default duckdbService;
