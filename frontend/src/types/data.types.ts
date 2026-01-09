// =============================================================================
// Shared Types (Same as backend)
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
    start: string;
    end: string;
}

export interface ComparisonConfig {
    currentPeriod: DateRange;
    comparisonPeriod: DateRange;
}

export interface QueryRequest {
    dimensions: string[];
    metrics: string[];
    filters: Filter[];
    sort: SortConfig[];
    offset: number;
    limit: number;
    comparison?: ComparisonConfig;
    search?: string;
}

// Columnar response format - optimized for performance
export interface ColumnarQueryResponse {
    columns: string[];           // Column names (sent once)
    columnTypes: string[];       // Column types for formatting
    data: (string | number | null)[][]; // Array of row arrays
    totalRows: number;
    queryTimeMs: number;
    cached: boolean;
    nextCursor?: string;
}

// Legacy object format (for backwards compatibility)
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
    format?: string;
    description?: string;
}

export interface TableMetadata {
    tableName: string;
    dimensions: DimensionColumn[];
    metrics: MetricColumn[];
}

// =============================================================================
// UI State Types - Updated for columnar format
// =============================================================================

export interface DataGridState {
    // Column selection
    selectedDimensions: string[];
    selectedMetrics: string[];

    // Filters and sorting
    filters: Filter[];
    sort: SortConfig[];

    // Search
    searchText: string;

    // Comparison period
    comparison: ComparisonConfig | null;

    // Loading state
    isLoading: boolean;
    error: string | null;

    // Metadata
    metadata: TableMetadata | null;

    // Columnar data format
    columns: string[];
    columnTypes: string[];
    data: (string | number | null)[][];
    totalRows: number;

    // Cache info
    cached: boolean;
    queryTimeMs: number;
}

// =============================================================================
// Row Spanning Types
// =============================================================================

export interface RowSpan {
    rowIndex: number;
    colIndex: number;
    span: number;
}

export interface RowSpanMap {
    [key: string]: RowSpan; // key: "rowIndex-colIndex"
}

