const express = require('express');
const { trinoService } = require('../services/trino.service');
const { queryBuilderService } = require('../services/query-builder.service');
const { cacheService } = require('../services/cache.service');

const router = express.Router();

// POST /api/data/query - Main data query endpoint (legacy object format)
router.post('/query', async (req, res) => {
    const startTime = Date.now();

    try {
        const request = req.body;

        if (!request.dimensions || request.dimensions.length === 0) {
            return res.status(400).json({ error: 'dimensions array is required' });
        }
        if (!request.metrics || request.metrics.length === 0) {
            return res.status(400).json({ error: 'metrics array is required' });
        }

        request.offset = request.offset ?? 0;
        request.limit = Math.min(request.limit ?? 50, 500);
        request.filters = request.filters ?? [];
        request.sort = request.sort ?? [];

        const cached = cacheService.get(request);
        if (cached) {
            return res.json({
                data: cached.data,
                totalRows: cached.totalRows,
                queryTimeMs: Date.now() - startTime,
                cached: true,
            });
        }

        const metadata = queryBuilderService.getMetadata();
        const { sql, countSql } = queryBuilderService.buildQuery(request, metadata.tableName);

        console.log('[DataController] Executing query:', sql.substring(0, 200) + '...');

        const [dataResult, countResult] = await Promise.all([
            trinoService.query(sql),
            trinoService.query(countSql),
        ]);

        const totalRows = countResult.data[0]?.total_count ?? 0;
        cacheService.set(request, dataResult.data, totalRows);

        return res.json({
            data: dataResult.data,
            totalRows,
            queryTimeMs: Date.now() - startTime,
            cached: false,
        });
    } catch (error) {
        console.error('[DataController] Query error:', error);
        return res.status(500).json({
            error: 'Query execution failed',
            message: error.message || 'Unknown error',
        });
    }
});

// POST /api/data/query-raw - Optimized columnar format endpoint
router.post('/query-raw', async (req, res) => {
    const startTime = Date.now();

    try {
        const request = req.body;

        if (!request.dimensions || request.dimensions.length === 0) {
            return res.status(400).json({ error: 'dimensions array is required' });
        }
        if (!request.metrics || request.metrics.length === 0) {
            return res.status(400).json({ error: 'metrics array is required' });
        }

        request.offset = request.offset ?? 0;
        request.limit = Math.min(request.limit ?? 100, 100000);
        request.filters = request.filters ?? [];
        request.sort = request.sort ?? [];

        const metadata = queryBuilderService.getMetadata();
        const { sql, countSql } = queryBuilderService.buildQuery(request, metadata.tableName);

        console.log('[DataController] Executing raw query:', sql.substring(0, 200) + '...');

        const [dataResult, countResult] = await Promise.all([
            trinoService.queryRaw(sql),
            trinoService.queryRaw(countSql),
        ]);

        const totalRows = Number(countResult.data[0]?.[0]) || 0;

        return res.json({
            columns: dataResult.columns,
            columnTypes: dataResult.columnTypes,
            data: dataResult.data,
            totalRows,
            queryTimeMs: Date.now() - startTime,
            cached: false,
        });
    } catch (error) {
        console.error('[DataController] Raw query error:', error);
        return res.status(500).json({
            error: 'Query execution failed',
            message: error.message || 'Unknown error',
        });
    }
});

// GET /api/data/metadata
router.get('/metadata', (_req, res) => {
    try {
        const metadata = queryBuilderService.getMetadata();
        return res.json(metadata);
    } catch (error) {
        console.error('[DataController] Metadata error:', error);
        return res.status(500).json({
            error: 'Failed to get metadata',
            message: error.message || 'Unknown error',
        });
    }
});

// GET /api/data/filters/:column
router.get('/filters/:column', async (req, res) => {
    try {
        const { column } = req.params;
        const limit = parseInt(req.query.limit, 10) || 1000;

        const fullTableName = queryBuilderService.getMetadata().tableName;
        const sql = queryBuilderService.buildDistinctValuesQuery(column, fullTableName, limit);

        const result = await trinoService.query(sql);
        const values = result.data.map((row) => row.value);

        return res.json({ column, values });
    } catch (error) {
        console.error('[DataController] Filter values error:', error);
        return res.status(500).json({
            error: 'Failed to get filter values',
            message: error.message || 'Unknown error',
        });
    }
});

// POST /api/data/search
router.post('/search', async (req, res) => {
    const startTime = Date.now();

    try {
        const { query, columns, limit = 50 } = req.body;

        if (!query || query.trim().length < 2) {
            return res.json({ results: [], queryTimeMs: 0 });
        }

        const searchColumns = columns || ['category', 'sub_category', 'sku', 'product_name'];
        const metadata = queryBuilderService.getMetadata();

        const validColumns = searchColumns.filter(col =>
            metadata.dimensions.some(d => d.name === col)
        );

        if (validColumns.length === 0) {
            return res.json({ results: [], queryTimeMs: 0 });
        }

        const searchTerm = query.trim().replace(/'/g, "''").toLowerCase();
        const fullTableName = metadata.tableName;
        const perColumnLimit = Math.ceil(limit / validColumns.length);

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

        const groupedResults = {};
        for (const row of result.data) {
            const columnName = row.column_name;
            if (!groupedResults[columnName]) {
                groupedResults[columnName] = [];
            }
            groupedResults[columnName].push(row.value);
        }

        const results = result.data.map(row => ({
            column: row.column_name,
            value: row.value,
            label: `${row.value} (${row.column_name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())})`,
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
            message: error.message || 'Unknown error',
        });
    }
});

// GET /api/data/cache/stats
router.get('/cache/stats', (_req, res) => {
    const stats = cacheService.getStats();
    return res.json(stats);
});

// POST /api/data/cache/clear
router.post('/cache/clear', (_req, res) => {
    cacheService.clear();
    return res.json({ success: true, message: 'Cache cleared' });
});

module.exports = router;
