const { trinoService } = require('./trino.service');

// Query Builder Service - Translates QueryRequest to Trino SQL

const DEFAULT_TABLE_NAME = 'lakehouse.ap_south1_gold.mv_ads_sales_analysis';

class QueryBuilderService {
    constructor() {
        this.tableName = DEFAULT_TABLE_NAME;
        this.dimensionColumns = [];
        this.metricColumns = [];
        this.validDimensions = new Set();
        this.validMetrics = new Set();
        this.initialized = false;
    }

    async initialize(tableName) {
        if (tableName) {
            this.tableName = tableName;
        }

        console.log(`[QueryBuilder] Initializing with table: ${this.tableName}`);

        try {
            const schema = await trinoService.getTableSchema(this.tableName);
            this.classifyColumns(schema);
            this.initialized = true;
            console.log(`[QueryBuilder] Initialized: ${this.dimensionColumns.length} dimensions, ${this.metricColumns.length} metrics`);
        } catch (error) {
            console.error('[QueryBuilder] Failed to initialize from schema:', error);
            throw error;
        }
    }

    classifyColumns(schema) {
        this.dimensionColumns = [];
        this.metricColumns = [];

        for (const col of schema) {
            const label = this.generateLabel(col.name);
            const trinoType = col.type.toLowerCase();

            if (trinoType.includes('varchar') || trinoType.includes('char')) {
                this.dimensionColumns.push({ name: col.name, label, type: 'string' });
            } else if (trinoType.includes('date') || trinoType.includes('timestamp')) {
                this.dimensionColumns.push({ name: col.name, label, type: 'date' });
            } else if (trinoType.includes('bigint') || trinoType.includes('integer') || trinoType.includes('int')) {
                this.metricColumns.push({ name: col.name, label, type: 'integer', aggregation: 'sum' });
            } else if (trinoType.includes('double') || trinoType.includes('decimal') || trinoType.includes('real')) {
                const isCurrency = col.name.includes('sale') || col.name.includes('spend') ||
                    col.name.includes('revenue') || col.name.includes('cost');
                this.metricColumns.push({
                    name: col.name,
                    label,
                    type: isCurrency ? 'currency' : 'number',
                    aggregation: 'sum',
                });
            } else {
                console.warn(`[QueryBuilder] Unknown type "${trinoType}" for column "${col.name}", treating as dimension`);
                this.dimensionColumns.push({ name: col.name, label, type: 'string' });
            }
        }

        this.validDimensions = new Set(this.dimensionColumns.map(c => c.name));
        this.validMetrics = new Set(this.metricColumns.map(c => c.name));
    }

    generateLabel(name) {
        return name
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    getMetadata() {
        return {
            tableName: this.tableName,
            dimensions: this.dimensionColumns,
            metrics: this.metricColumns,
        };
    }

    isInitialized() {
        return this.initialized;
    }

    buildQuery(request, fullTableName) {
        const validDimensions = request.dimensions.filter(d => this.validDimensions.has(d));
        const validMetrics = request.metrics.filter(m => this.validMetrics.has(m));

        if (validDimensions.length === 0) {
            throw new Error('At least one valid dimension is required');
        }

        const selectParts = [];

        for (const dim of validDimensions) {
            selectParts.push(`"${dim}"`);
        }

        if (request.comparison) {
            for (const metric of validMetrics) {
                const { currentPeriod, comparisonPeriod } = request.comparison;

                selectParts.push(
                    `SUM(CASE WHEN "date" >= DATE '${currentPeriod.start}' AND "date" <= DATE '${currentPeriod.end}' THEN "${metric}" ELSE 0 END) AS "${metric}_curr"`
                );
                selectParts.push(
                    `SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END) AS "${metric}_comp"`
                );
                selectParts.push(
                    `SUM(CASE WHEN "date" >= DATE '${currentPeriod.start}' AND "date" <= DATE '${currentPeriod.end}' THEN "${metric}" ELSE 0 END) - ` +
                    `SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END) AS "${metric}_diff"`
                );
                selectParts.push(
                    `CASE WHEN SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END) = 0 THEN NULL ` +
                    `ELSE ROUND((SUM(CASE WHEN "date" >= DATE '${currentPeriod.start}' AND "date" <= DATE '${currentPeriod.end}' THEN "${metric}" ELSE 0 END) - ` +
                    `SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END)) * 100.0 / ` +
                    `NULLIF(SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END), 0), 2) END AS "${metric}_diff_pct"`
                );
            }
        } else {
            for (const metric of validMetrics) {
                selectParts.push(`SUM("${metric}") AS "${metric}"`);
            }
        }

        const whereParts = this.buildWhereClause(request.filters);

        if (request.search && request.search.trim()) {
            const searchTerm = request.search.trim().replace(/'/g, "''");
            const searchConditions = validDimensions
                .map(dim => `LOWER(CAST("${dim}" AS VARCHAR)) LIKE LOWER('%${searchTerm}%')`)
                .join(' OR ');
            if (searchConditions) {
                whereParts.push(`(${searchConditions})`);
            }
        }

        const groupByClause = validDimensions.map(d => `"${d}"`).join(', ');
        const orderByClause = this.buildOrderByClause(request.sort, validDimensions, validMetrics, !!request.comparison);
        const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

        const sql = `
SELECT ${selectParts.join(',\n       ')}
FROM ${fullTableName}
${whereClause}
GROUP BY ${groupByClause}
${orderByClause}
OFFSET ${request.offset} ROWS
FETCH NEXT ${request.limit} ROWS ONLY
    `.trim();

        const countSql = `
SELECT COUNT(*) AS total_count
FROM (
  SELECT ${validDimensions.map(d => `"${d}"`).join(', ')}
  FROM ${fullTableName}
  ${whereClause}
  GROUP BY ${groupByClause}
) subquery
    `.trim();

        return { sql, countSql, params: [] };
    }

    buildWhereClause(filters) {
        const conditions = [];

        for (const filter of filters) {
            if (!this.validDimensions.has(filter.column) && !this.validMetrics.has(filter.column)) {
                console.warn(`[QueryBuilder] Skipping invalid column: ${filter.column}`);
                continue;
            }

            const column = `"${filter.column}"`;
            const condition = this.buildFilterCondition(column, filter);
            if (condition) {
                conditions.push(condition);
            }
        }

        return conditions;
    }

    buildFilterCondition(column, filter) {
        const { operator, value } = filter;

        switch (operator) {
            case 'eq':
                return `${column} = ${this.escapeValue(value)}`;
            case 'neq':
                return `${column} != ${this.escapeValue(value)}`;
            case 'gt':
                return `${column} > ${this.escapeValue(value)}`;
            case 'gte':
                return `${column} >= ${this.escapeValue(value)}`;
            case 'lt':
                return `${column} < ${this.escapeValue(value)}`;
            case 'lte':
                return `${column} <= ${this.escapeValue(value)}`;
            case 'in':
                if (Array.isArray(value)) {
                    const values = value.map(v => this.escapeValue(v)).join(', ');
                    return `${column} IN (${values})`;
                }
                return null;
            case 'nin':
                if (Array.isArray(value)) {
                    const values = value.map(v => this.escapeValue(v)).join(', ');
                    return `${column} NOT IN (${values})`;
                }
                return null;
            case 'between':
                if (Array.isArray(value) && value.length === 2) {
                    return `${column} BETWEEN ${this.escapeValue(value[0])} AND ${this.escapeValue(value[1])}`;
                }
                return null;
            case 'like':
                return `${column} LIKE ${this.escapeValue(value)}`;
            case 'ilike':
                return `LOWER(${column}) LIKE LOWER(${this.escapeValue(value)})`;
            default:
                return null;
        }
    }

    escapeValue(value) {
        if (value === null) return 'NULL';
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        if (typeof value === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                return `DATE '${value}'`;
            }
            return `'${value.replace(/'/g, "''")}'`;
        }
        return `'${String(value).replace(/'/g, "''")}'`;
    }

    buildOrderByClause(sort, validDimensions, validMetrics, isComparison = false) {
        const dimensionOrderParts = validDimensions.map(d => `"${d}" ASC`);

        if (!sort || sort.length === 0) {
            return `ORDER BY ${dimensionOrderParts.join(', ')}`;
        }

        const validColumns = new Set([...validDimensions, ...validMetrics]);
        const userOrderParts = [];

        for (const s of sort) {
            let columnName = s.column;
            // Already has comparison suffix - use as-is
            if (columnName.endsWith('_curr') || columnName.endsWith('_comp') ||
                columnName.endsWith('_diff') || columnName.endsWith('_diff_pct')) {
                userOrderParts.push(`"${columnName}" ${s.direction.toUpperCase()}`);
            } else if (validColumns.has(columnName)) {
                // It's a valid column
                if (!validDimensions.includes(columnName)) {
                    // It's a metric - add _curr suffix if in comparison mode
                    const orderColumn = isComparison ? `${columnName}_curr` : columnName;
                    userOrderParts.push(`"${orderColumn}" ${s.direction.toUpperCase()}`);
                }
            }
        }

        const allOrderParts = [...dimensionOrderParts, ...userOrderParts];
        return `ORDER BY ${allOrderParts.join(', ')}`;
    }

    buildDistinctValuesQuery(column, fullTableName, limit = 1000) {
        if (!this.validDimensions.has(column)) {
            throw new Error(`Invalid dimension column: ${column}`);
        }

        return `
SELECT DISTINCT "${column}" AS value
FROM ${fullTableName}
WHERE "${column}" IS NOT NULL
ORDER BY "${column}"
LIMIT ${limit}
    `.trim();
    }
}

const queryBuilderService = new QueryBuilderService();
module.exports = { queryBuilderService };
