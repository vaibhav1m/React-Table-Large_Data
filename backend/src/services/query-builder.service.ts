import {
    QueryRequest,
    Filter,
    SortConfig,
    GeneratedQuery,
    DimensionColumn,
    MetricColumn,
    TableMetadata,
    ColumnType,
} from '../types/data.types';
import { trinoService } from './trino.service';

// =============================================================================
// Query Builder Service - Translates QueryRequest to Trino SQL
// =============================================================================

// Default table name - can be overridden via initialize()
const DEFAULT_TABLE_NAME = 'lakehouse.ap_south1_gold.mv_ads_sales_analysis';

class QueryBuilderService {
    private tableName: string = DEFAULT_TABLE_NAME;
    private dimensionColumns: DimensionColumn[] = [];
    private metricColumns: MetricColumn[] = [];
    private validDimensions: Set<string> = new Set();
    private validMetrics: Set<string> = new Set();
    private initialized: boolean = false;

    /**
     * Initialize the query builder by fetching schema from Trino
     */
    async initialize(tableName?: string): Promise<void> {
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

    /**
     * Classify columns as dimensions or metrics based on their data types
     */
    private classifyColumns(schema: Array<{ name: string; type: string }>): void {
        this.dimensionColumns = [];
        this.metricColumns = [];

        for (const col of schema) {
            const label = this.generateLabel(col.name);
            const trinoType = col.type.toLowerCase();

            // Classify by Trino data type
            if (trinoType.includes('varchar') || trinoType.includes('char')) {
                this.dimensionColumns.push({
                    name: col.name,
                    label,
                    type: 'string' as ColumnType,
                });
            } else if (trinoType.includes('date') || trinoType.includes('timestamp')) {
                this.dimensionColumns.push({
                    name: col.name,
                    label,
                    type: 'date' as ColumnType,
                });
            } else if (trinoType.includes('bigint') || trinoType.includes('integer') || trinoType.includes('int')) {
                this.metricColumns.push({
                    name: col.name,
                    label,
                    type: 'integer' as ColumnType,
                    aggregation: 'sum',
                });
            } else if (trinoType.includes('double') || trinoType.includes('decimal') || trinoType.includes('real')) {
                // Determine if it's currency based on name
                const isCurrency = col.name.includes('sale') || col.name.includes('spend') ||
                    col.name.includes('revenue') || col.name.includes('cost');
                this.metricColumns.push({
                    name: col.name,
                    label,
                    type: isCurrency ? 'currency' as ColumnType : 'number' as ColumnType,
                    aggregation: 'sum',
                });
            } else {
                // Default to dimension for unknown types
                console.warn(`[QueryBuilder] Unknown type "${trinoType}" for column "${col.name}", treating as dimension`);
                this.dimensionColumns.push({
                    name: col.name,
                    label,
                    type: 'string' as ColumnType,
                });
            }
        }

        // Build validation sets
        this.validDimensions = new Set(this.dimensionColumns.map((c) => c.name));
        this.validMetrics = new Set(this.metricColumns.map((c) => c.name));
    }

    /**
     * Generate a human-readable label from column name
     * e.g., "ads_spend" -> "Ads Spend", "master_brand_id" -> "Master Brand Id"
     */
    private generateLabel(name: string): string {
        return name
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Get table metadata for frontend
     */
    getMetadata(): TableMetadata {
        return {
            tableName: this.tableName,
            dimensions: this.dimensionColumns,
            metrics: this.metricColumns,
        };
    }

    /**
     * Check if the service is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Build SQL query from QueryRequest
     */
    buildQuery(request: QueryRequest, fullTableName: string): GeneratedQuery {
        // Validate dimensions and metrics
        const validDimensions = request.dimensions.filter((d) => this.validDimensions.has(d));
        const validMetrics = request.metrics.filter((m) => this.validMetrics.has(m));

        if (validDimensions.length === 0) {
            throw new Error('At least one valid dimension is required');
        }

        // Build SELECT clause
        const selectParts: string[] = [];

        // Add dimension columns
        for (const dim of validDimensions) {
            selectParts.push(`"${dim}"`);
        }

        // Add metric columns with aggregation
        if (request.comparison) {
            // With comparison: generate curr, comp, diff, diff_pct columns
            for (const metric of validMetrics) {
                const { currentPeriod, comparisonPeriod } = request.comparison;

                // Current period
                selectParts.push(
                    `SUM(CASE WHEN "date" >= DATE '${currentPeriod.start}' AND "date" <= DATE '${currentPeriod.end}' THEN "${metric}" ELSE 0 END) AS "${metric}_curr"`
                );

                // Comparison period
                selectParts.push(
                    `SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END) AS "${metric}_comp"`
                );

                // Difference (curr - comp)
                selectParts.push(
                    `SUM(CASE WHEN "date" >= DATE '${currentPeriod.start}' AND "date" <= DATE '${currentPeriod.end}' THEN "${metric}" ELSE 0 END) - ` +
                    `SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END) AS "${metric}_diff"`
                );

                // Difference percentage
                selectParts.push(
                    `CASE WHEN SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END) = 0 THEN NULL ` +
                    `ELSE ROUND((SUM(CASE WHEN "date" >= DATE '${currentPeriod.start}' AND "date" <= DATE '${currentPeriod.end}' THEN "${metric}" ELSE 0 END) - ` +
                    `SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END)) * 100.0 / ` +
                    `NULLIF(SUM(CASE WHEN "date" >= DATE '${comparisonPeriod.start}' AND "date" <= DATE '${comparisonPeriod.end}' THEN "${metric}" ELSE 0 END), 0), 2) END AS "${metric}_diff_pct"`
                );
            }
        } else {
            // Without comparison: simple aggregation
            for (const metric of validMetrics) {
                selectParts.push(`SUM("${metric}") AS "${metric}"`);
            }
        }

        // Build WHERE clause
        const whereParts = this.buildWhereClause(request.filters);

        // Add search filter if provided
        if (request.search && request.search.trim()) {
            const searchTerm = request.search.trim().replace(/'/g, "''");
            const searchConditions = validDimensions
                .map((dim) => `LOWER(CAST("${dim}" AS VARCHAR)) LIKE LOWER('%${searchTerm}%')`)
                .join(' OR ');
            if (searchConditions) {
                whereParts.push(`(${searchConditions})`);
            }
        }

        // Build GROUP BY clause
        const groupByClause = validDimensions.map((d) => `"${d}"`).join(', ');

        // Build ORDER BY clause
        const orderByClause = this.buildOrderByClause(request.sort, validDimensions, validMetrics);

        // Construct main query
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

        // Build count query (for total rows)
        const countSql = `
SELECT COUNT(*) AS total_count
FROM (
  SELECT ${validDimensions.map((d) => `"${d}"`).join(', ')}
  FROM ${fullTableName}
  ${whereClause}
  GROUP BY ${groupByClause}
) subquery
    `.trim();

        return { sql, countSql, params: [] };
    }

    /**
     * Build WHERE clause from filters
     */
    private buildWhereClause(filters: Filter[]): string[] {
        const conditions: string[] = [];

        for (const filter of filters) {
            // Validate column exists
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

    /**
     * Build individual filter condition
     */
    private buildFilterCondition(column: string, filter: Filter): string | null {
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
                    const values = value.map((v) => this.escapeValue(v)).join(', ');
                    return `${column} IN (${values})`;
                }
                return null;
            case 'nin':
                if (Array.isArray(value)) {
                    const values = value.map((v) => this.escapeValue(v)).join(', ');
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

    /**
     * Escape value for SQL
     */
    private escapeValue(value: unknown): string {
        if (value === null) return 'NULL';
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        if (typeof value === 'string') {
            // Check if it's a date
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                return `DATE '${value}'`;
            }
            return `'${value.replace(/'/g, "''")}'`;
        }
        return `'${String(value).replace(/'/g, "''")}'`;
    }

    /**
     * Build ORDER BY clause
     */
    private buildOrderByClause(
        sort: SortConfig[],
        validDimensions: string[],
        validMetrics: string[]
    ): string {
        if (!sort || sort.length === 0) {
            // Default sort by first dimension
            return `ORDER BY "${validDimensions[0]}" ASC`;
        }

        const validColumns = new Set([...validDimensions, ...validMetrics]);
        const orderParts: string[] = [];

        for (const s of sort) {
            // Handle metric columns with _curr suffix
            let columnName = s.column;
            if (columnName.endsWith('_curr') || columnName.endsWith('_comp') ||
                columnName.endsWith('_diff') || columnName.endsWith('_diff_pct')) {
                // These are calculated columns, use as-is
                orderParts.push(`"${columnName}" ${s.direction.toUpperCase()}`);
            } else if (validColumns.has(columnName)) {
                orderParts.push(`"${columnName}" ${s.direction.toUpperCase()}`);
            }
        }

        return orderParts.length > 0 ? `ORDER BY ${orderParts.join(', ')}` : '';
    }

    /**
     * Get distinct values for a dimension column (for filter dropdowns)
     */
    buildDistinctValuesQuery(column: string, fullTableName: string, limit: number = 1000): string {
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

// Export singleton instance
export const queryBuilderService = new QueryBuilderService();
