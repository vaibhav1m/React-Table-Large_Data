import { Request, Response, Router } from 'express';
import { trinoService } from '../services/trino.service';
import { queryBuilderService } from '../services/query-builder.service';
import { cacheService } from '../services/cache.service';
import { QueryRequest, QueryResponse, ColumnarQueryResponse } from '../types/data.types';

const router = Router();

// =============================================================================
// POST /api/data/query - Main data query endpoint (legacy object format)
// =============================================================================
router.post('/query', async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
        const request: QueryRequest = req.body;

        // Validate request
        if (!request.dimensions || request.dimensions.length === 0) {
            return res.status(400).json({ error: 'dimensions array is required' });
        }
        if (!request.metrics || request.metrics.length === 0) {
            return res.status(400).json({ error: 'metrics array is required' });
        }

        // Set defaults
        request.offset = request.offset ?? 0;
        request.limit = Math.min(request.limit ?? 50, 500); // Max 500 rows per request
        request.filters = request.filters ?? [];
        request.sort = request.sort ?? [];

        // Check cache
        const cached = cacheService.get<Record<string, unknown>>(request);
        if (cached) {
            const response: QueryResponse = {
                data: cached.data,
                totalRows: cached.totalRows,
                queryTimeMs: Date.now() - startTime,
                cached: true,
            };
            return res.json(response);
        }

        // Build SQL queries
        const metadata = queryBuilderService.getMetadata();
        const fullTableName = metadata.tableName;
        const { sql, countSql } = queryBuilderService.buildQuery(request, fullTableName);

        console.log('[DataController] Executing query:', sql.substring(0, 200) + '...');

        // Execute queries in parallel
        const [dataResult, countResult] = await Promise.all([
            trinoService.query(sql),
            trinoService.query(countSql),
        ]);

        const totalRows = countResult.data[0]?.total_count as number ?? 0;

        // Cache the result
        cacheService.set(request, dataResult.data, totalRows);

        const response: QueryResponse = {
            data: dataResult.data,
            totalRows,
            queryTimeMs: Date.now() - startTime,
            cached: false,
        };

        return res.json(response);
    } catch (error) {
        console.error('[DataController] Query error:', error);
        return res.status(500).json({
            error: 'Query execution failed',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =============================================================================
// POST /api/data/query-raw - Optimized columnar format endpoint
// Returns columns once + data as array of arrays (60% smaller, faster parsing)
// =============================================================================
router.post('/query-raw', async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
        const request: QueryRequest = req.body;

        // Validate request
        if (!request.dimensions || request.dimensions.length === 0) {
            return res.status(400).json({ error: 'dimensions array is required' });
        }
        if (!request.metrics || request.metrics.length === 0) {
            return res.status(400).json({ error: 'metrics array is required' });
        }

        // Set defaults
        request.offset = request.offset ?? 0;
        request.limit = Math.min(request.limit ?? 100, 100000); // Allow loading all data for DuckDB initialization
        request.filters = request.filters ?? [];
        request.sort = request.sort ?? [];

        // Build SQL queries
        const metadata = queryBuilderService.getMetadata();
        const fullTableName = metadata.tableName;
        const { sql, countSql } = queryBuilderService.buildQuery(request, fullTableName);

        console.log('[DataController] Executing raw query:', sql.substring(0, 200) + '...');

        // Execute queries in parallel using raw format
        const [dataResult, countResult] = await Promise.all([
            trinoService.queryRaw(sql),
            trinoService.queryRaw(countSql),
        ]);

        const totalRows = Number(countResult.data[0]?.[0]) || 0;

        const response: ColumnarQueryResponse = {
            columns: dataResult.columns,
            columnTypes: dataResult.columnTypes,
            data: dataResult.data,
            totalRows,
            queryTimeMs: Date.now() - startTime,
            cached: false,
        };

        return res.json(response);
    } catch (error) {
        console.error('[DataController] Raw query error:', error);
        return res.status(500).json({
            error: 'Query execution failed',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =============================================================================
// GET /api/data/metadata - Get table metadata (columns, types)
// =============================================================================
router.get('/metadata', (_req: Request, res: Response) => {
    try {
        const metadata = queryBuilderService.getMetadata();
        return res.json(metadata);
    } catch (error) {
        console.error('[DataController] Metadata error:', error);
        return res.status(500).json({
            error: 'Failed to get metadata',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =============================================================================
// GET /api/data/filters/:column - Get distinct values for filter dropdown
// =============================================================================
router.get('/filters/:column', async (req: Request, res: Response) => {
    try {
        const { column } = req.params;
        const limit = parseInt(req.query.limit as string, 10) || 1000;

        const fullTableName = queryBuilderService.getMetadata().tableName;
        const sql = queryBuilderService.buildDistinctValuesQuery(column, fullTableName, limit);

        const result = await trinoService.query(sql);
        const values = result.data.map((row) => row.value);

        return res.json({ column, values });
    } catch (error) {
        console.error('[DataController] Filter values error:', error);
        return res.status(500).json({
            error: 'Failed to get filter values',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =============================================================================
// POST /api/data/search - Search across Category, SubCategory, SKU, ProductName
// Returns matching results for autocomplete dropdown
// =============================================================================
router.post('/search', async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
        const { query, columns, limit = 50 } = req.body as {
            query: string;
            columns?: string[];
            limit?: number;
        };

        // Validate query
        if (!query || query.trim().length < 2) {
            return res.json({ results: [], queryTimeMs: 0 });
        }

        // Default search columns: category, sub_category, sku, product_name
        const searchColumns = columns || ['category', 'sub_category', 'sku', 'product_name'];
        const metadata = queryBuilderService.getMetadata();

        // Filter to only valid dimension columns
        const validColumns = searchColumns.filter(col =>
            metadata.dimensions.some(d => d.name === col)
        );

        if (validColumns.length === 0) {
            return res.json({ results: [], queryTimeMs: 0 });
        }

        // Build search query
        const searchTerm = query.trim().replace(/'/g, "''").toLowerCase();
        const fullTableName = metadata.tableName;
        const perColumnLimit = Math.ceil(limit / validColumns.length);

        // Build UNION query for each column - wrap in subqueries for valid Trino SQL
        const unionQueries = validColumns.map(col => `
            (SELECT DISTINCT '${col}' AS column_name, CAST("${col}" AS VARCHAR) AS value
             FROM ${fullTableName}
             WHERE LOWER(CAST("${col}" AS VARCHAR)) LIKE '%${searchTerm}%'
             AND "${col}" IS NOT NULL
             LIMIT ${perColumnLimit})
        `);

        const sql = `
            SELECT column_name, value FROM (
                ${unionQueries.join(' UNION ALL ')}
            ) combined
            ORDER BY 
                CASE WHEN LOWER(value) LIKE '${searchTerm}%' THEN 0 ELSE 1 END,
                LENGTH(value)
            LIMIT ${limit}
        `;

        console.log('[DataController] Executing search query for:', searchTerm);

        const result = await trinoService.query(sql);

        // Group results by column
        const groupedResults: Record<string, string[]> = {};
        for (const row of result.data) {
            const columnName = row.column_name as string;
            const value = row.value as string;
            if (!groupedResults[columnName]) {
                groupedResults[columnName] = [];
            }
            groupedResults[columnName].push(value);
        }

        // Transform to flat results with metadata
        const results = result.data.map(row => ({
            column: row.column_name as string,
            value: row.value as string,
            label: `${row.value} (${(row.column_name as string).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())})`,
        }));

        return res.json({
            results,
            groupedResults,
            queryTimeMs: Date.now() - startTime,
        });
    } catch (error) {
        console.error('[DataController] Search error:', error);
        return res.status(500).json({
            error: 'Search failed',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =============================================================================
// GET /api/data/cache/stats - Get cache statistics
// =============================================================================
router.get('/cache/stats', (_req: Request, res: Response) => {
    const stats = cacheService.getStats();
    return res.json(stats);
});

// =============================================================================
// POST /api/data/cache/clear - Clear cache
// =============================================================================
router.post('/cache/clear', (_req: Request, res: Response) => {
    cacheService.clear();
    return res.json({ success: true, message: 'Cache cleared' });
});

export default router;
