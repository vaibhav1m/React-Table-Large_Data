// =============================================================================
// Query Request/Response Types
// =============================================================================

export interface Filter {
    column: string;
    operator: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'like' | 'ilike';
    value: string | number | boolean | (string | number)[] | null;
}

export interface SortConfig {
    column: string;
    direction: 'asc' | 'desc';
}

export interface DateRange {
    start: string; // ISO date string
    end: string;
}

export interface ComparisonConfig {
    currentPeriod: DateRange;
    comparisonPeriod: DateRange;
}

export interface QueryRequest {
    // Dimension columns for grouping (drill-down level)
    dimensions: string[];

    // Metric columns to aggregate
    metrics: string[];

    // Filters to apply
    filters: Filter[];

    // Sort configuration
    sort: SortConfig[];

    // Pagination - offset-based (legacy)
    offset: number;
    limit: number;

    // Cursor-based pagination (preferred for deep pages)
    cursor?: string;

    // Optional: comparison periods for Curr vs Comp metrics
    comparison?: ComparisonConfig;

    // Optional: text search across dimension columns
    search?: string;
}

// Columnar response format - columns sent once, data as arrays
export interface ColumnarQueryResponse {
    columns: string[];           // Column names (sent once)
    columnTypes: string[];       // Column types for formatting
    data: (string | number | null)[][]; // Array of row arrays
    totalRows: number;
    queryTimeMs: number;
    cached: boolean;
    nextCursor?: string;         // For cursor-based pagination
}

// Legacy format for backwards compatibility
export interface QueryResponse<T = Record<string, unknown>> {
    data: T[];
    totalRows: number;
    queryTimeMs: number;
    cached: boolean;
}

// =============================================================================
// Metadata Types
// =============================================================================

export type ColumnType = 'string' | 'number' | 'currency' | 'percentage' | 'date' | 'integer';
export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'calculated';

export interface DimensionColumn {
    name: string;
    label: string;
    type: ColumnType;
    description?: string;
}

export interface MetricColumn {
    name: string;
    label: string;
    type: ColumnType;
    aggregation: AggregationType;
    format?: string; // e.g., '0,0.00' for numeral.js
    description?: string;
}

export interface TableMetadata {
    tableName: string;
    dimensions: DimensionColumn[];
    metrics: MetricColumn[];
}

// =============================================================================
// Configuration Types
// =============================================================================

export interface TrinoConfig {
    host: string;
    port: number;
    user: string;
    catalog: string;
    schema: string;
}

export interface CacheConfig {
    ttlSeconds: number;
    maxSize: number;
}

// =============================================================================
// Internal Types
// =============================================================================

export interface GeneratedQuery {
    sql: string;
    countSql: string;
    params: unknown[];
}
