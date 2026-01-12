import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { dataService } from '../services/api.service';
import type {
    DataGridState,
    Filter,
    SortConfig,
    ComparisonConfig,
} from '../types/data.types';

// =============================================================================
// Configuration - Tunable parameters for prefetching
// =============================================================================

const BATCH_SIZE = 2000;           // Rows per server request
const MAX_CACHED_ROWS = 10000;     // Max rows to keep in memory

// =============================================================================
// State - Server-side queries with smart prefetching
// =============================================================================

interface PrefetchState extends DataGridState {
    // All data (with all metrics)
    allColumns: string[];           // All columns from server
    allColumnTypes: string[];       // All column types from server
    allData: (string | number | null)[][];  // Full data with all metrics

    // Visible columns (filtered by selectedMetrics)
    visibleColumns: string[];
    visibleColumnTypes: string[];

    // Data management
    loadedRanges: { start: number; end: number }[];     // Tracked loaded ranges

    // Prefetch state
    isPrefetching: boolean;
    lastScrollPosition: number;     // For scroll direction detection

    // Query state
    currentQueryId: number;         // For cancelling stale queries
    needsDataRefresh: boolean;      // Flag to trigger data refresh
}

const initialState: PrefetchState = {
    selectedDimensions: ['master_brand_id'],
    selectedMetrics: ['ads_spend', 'ads_sale', 'gross_sale'],
    filters: [],
    sort: [{ column: 'ads_spend', direction: 'desc' }],
    searchText: '',
    comparison: null,
    isLoading: false,
    error: null,
    metadata: null,
    columns: [],
    columnTypes: [],
    data: [],
    totalRows: 0,
    cached: false,
    queryTimeMs: 0,

    // All data storage
    allColumns: [],
    allColumnTypes: [],
    allData: [],

    // Visible columns
    visibleColumns: [],
    visibleColumnTypes: [],

    // Prefetch state
    loadedRanges: [],
    isPrefetching: false,
    lastScrollPosition: 0,
    currentQueryId: 0,
    needsDataRefresh: true,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a range is already loaded
 */
function isRangeLoaded(ranges: { start: number; end: number }[], offset: number, limit: number): boolean {
    const requestEnd = offset + limit;
    return ranges.some(range => range.start <= offset && range.end >= requestEnd);
}

/**
 * Merge overlapping/adjacent ranges
 */
function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const current = sorted[i];

        if (current.start <= last.end + 1) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push(current);
        }
    }

    return merged;
}

/**
 * Filter data to show only selected columns
 */
function filterVisibleData(
    allColumns: string[],
    allData: (string | number | null)[][],
    selectedDimensions: string[],
    selectedMetrics: string[]
): {
    visibleColumns: string[];
    visibleData: (string | number | null)[][];
    columnIndices: number[];
} {
    // Build list of columns to show: dimensions first, then selected metrics
    const visibleColumns = [...selectedDimensions, ...selectedMetrics];

    // Find indices of visible columns in allColumns
    const columnIndices = visibleColumns.map(col => allColumns.indexOf(col)).filter(idx => idx !== -1);

    // Extract only visible columns from each row
    const visibleData = allData.map(row =>
        columnIndices.map(idx => row[idx])
    );

    return {
        visibleColumns: columnIndices.map(idx => allColumns[idx]),
        visibleData,
        columnIndices,
    };
}

// =============================================================================
// Async Thunks
// =============================================================================

export const fetchMetadata = createAsyncThunk(
    'dataGrid/fetchMetadata',
    async () => {
        const metadata = await dataService.getMetadata();
        return metadata;
    }
);

/**
 * Fetch data with ALL metrics (dimensions + all metrics)
 * This is called when dimensions, filters, sort, or search changes
 */
export const fetchInitialData = createAsyncThunk(
    'dataGrid/fetchInitialData',
    async (_, { getState }) => {
        const state = getState() as { dataGrid: PrefetchState };
        const { selectedDimensions, metadata, filters, sort, searchText, comparison } = state.dataGrid;

        if (!metadata) {
            throw new Error('Metadata not loaded');
        }

        // Get ALL metric names from metadata
        const allMetricNames = metadata.metrics.map(m => m.name);

        console.log('[DataGrid] Fetching data with all metrics...');

        const request = {
            dimensions: selectedDimensions,
            metrics: allMetricNames,  // Fetch ALL metrics
            filters,
            sort,
            offset: 0,
            limit: BATCH_SIZE,
            search: searchText || undefined,
            comparison: comparison ?? undefined,
        };

        const response = await dataService.queryRaw(request);
        return {
            ...response,
            allMetricNames,
        };
    }
);

/**
 * Fetch more data (for infinite scroll)
 */
export const fetchDataRange = createAsyncThunk(
    'dataGrid/fetchDataRange',
    async (params: { offset: number; limit?: number; isPrefetch?: boolean }, { getState }) => {
        const state = getState() as { dataGrid: PrefetchState };
        const { selectedDimensions, metadata, filters, sort, searchText, comparison, loadedRanges } = state.dataGrid;

        if (!metadata) {
            throw new Error('Metadata not loaded');
        }

        const limit = params.limit ?? BATCH_SIZE;

        // Skip if already loaded
        if (isRangeLoaded(loadedRanges, params.offset, limit)) {
            console.log(`[DataGrid] Range ${params.offset}-${params.offset + limit} already loaded, skipping`);
            return null;
        }

        // Get ALL metric names from metadata
        const allMetricNames = metadata.metrics.map(m => m.name);

        console.log(`[DataGrid] Fetching range ${params.offset}-${params.offset + limit} (prefetch: ${params.isPrefetch})`);

        const request = {
            dimensions: selectedDimensions,
            metrics: allMetricNames,  // Fetch ALL metrics
            filters,
            sort,
            offset: params.offset,
            limit,
            search: searchText || undefined,
            comparison: comparison ?? undefined,
        };

        const response = await dataService.queryRaw(request, params.isPrefetch);
        return {
            ...response,
            offset: params.offset,
            isPrefetch: params.isPrefetch ?? false,
        };
    }
);

// =============================================================================
// Slice
// =============================================================================

const dataGridSlice = createSlice({
    name: 'dataGrid',
    initialState,
    reducers: {
        // Dimension changes require API call
        setSelectedDimensions: (state, action: PayloadAction<string[]>) => {
            state.selectedDimensions = action.payload;
            // Reset data - will trigger new API call
            state.allData = [];
            state.loadedRanges = [];
            state.needsDataRefresh = true;
        },
        addDimension: (state, action: PayloadAction<string>) => {
            if (!state.selectedDimensions.includes(action.payload)) {
                state.selectedDimensions.push(action.payload);
                state.allData = [];
                state.loadedRanges = [];
                state.needsDataRefresh = true;
            }
        },
        removeDimension: (state, action: PayloadAction<string>) => {
            state.selectedDimensions = state.selectedDimensions.filter((d) => d !== action.payload);
            state.allData = [];
            state.loadedRanges = [];
            state.needsDataRefresh = true;
        },

        // Metrics changes do NOT require API call - just show/hide columns
        setSelectedMetrics: (state, action: PayloadAction<string[]>) => {
            state.selectedMetrics = action.payload;
            // Re-filter visible data from allData (no API call!)
            if (state.allData.length > 0) {
                const { visibleColumns, visibleData } = filterVisibleData(
                    state.allColumns,
                    state.allData,
                    state.selectedDimensions,
                    action.payload
                );
                state.columns = visibleColumns;
                state.data = visibleData;
                state.columnTypes = visibleColumns.map(col => {
                    const idx = state.allColumns.indexOf(col);
                    return idx >= 0 ? state.allColumnTypes[idx] : 'varchar';
                });
            }
        },
        toggleMetric: (state, action: PayloadAction<string>) => {
            const index = state.selectedMetrics.indexOf(action.payload);
            if (index === -1) {
                state.selectedMetrics.push(action.payload);
            } else {
                state.selectedMetrics.splice(index, 1);
            }
            // Re-filter visible data (no API call!)
            if (state.allData.length > 0) {
                const { visibleColumns, visibleData } = filterVisibleData(
                    state.allColumns,
                    state.allData,
                    state.selectedDimensions,
                    state.selectedMetrics
                );
                state.columns = visibleColumns;
                state.data = visibleData;
                state.columnTypes = visibleColumns.map(col => {
                    const idx = state.allColumns.indexOf(col);
                    return idx >= 0 ? state.allColumnTypes[idx] : 'varchar';
                });
            }
        },

        // Filters require API call
        setFilters: (state, action: PayloadAction<Filter[]>) => {
            state.filters = action.payload;
            state.allData = [];
            state.loadedRanges = [];
            state.needsDataRefresh = true;
        },
        addFilter: (state, action: PayloadAction<Filter>) => {
            state.filters.push(action.payload);
            state.allData = [];
            state.loadedRanges = [];
            state.needsDataRefresh = true;
        },
        removeFilter: (state, action: PayloadAction<number>) => {
            state.filters.splice(action.payload, 1);
            state.allData = [];
            state.loadedRanges = [];
            state.needsDataRefresh = true;
        },

        // Sort requires API call
        setSort: (state, action: PayloadAction<SortConfig[]>) => {
            state.sort = action.payload;
            state.allData = [];
            state.loadedRanges = [];
            state.needsDataRefresh = true;
        },

        setSearchText: (state, action: PayloadAction<string>) => {
            state.searchText = action.payload;
        },
        setComparison: (state, action: PayloadAction<ComparisonConfig | null>) => {
            state.comparison = action.payload;
        },
        clearError: (state) => {
            state.error = null;
        },
        updateScrollPosition: (state, action: PayloadAction<number>) => {
            state.lastScrollPosition = action.payload;
        },
        // Mark refresh as complete
        markRefreshComplete: (state) => {
            state.needsDataRefresh = false;
        },
    },
    extraReducers: (builder) => {
        builder
            // Fetch Metadata
            .addCase(fetchMetadata.pending, (state) => {
                state.isLoading = true;
                state.error = null;
            })
            .addCase(fetchMetadata.fulfilled, (state, action) => {
                state.isLoading = false;
                state.metadata = action.payload;
            })
            .addCase(fetchMetadata.rejected, (state, action) => {
                state.isLoading = false;
                state.error = action.error.message ?? 'Failed to fetch metadata';
            })

            // Fetch Initial Data (with all metrics)
            .addCase(fetchInitialData.pending, (state) => {
                state.isLoading = true;
                state.error = null;
                state.currentQueryId += 1;
            })
            .addCase(fetchInitialData.fulfilled, (state, action) => {
                state.isLoading = false;
                state.needsDataRefresh = false;

                // Store ALL columns and data
                state.allColumns = action.payload.columns;
                state.allColumnTypes = action.payload.columnTypes;
                state.allData = action.payload.data;
                state.totalRows = action.payload.totalRows;
                state.queryTimeMs = action.payload.queryTimeMs;
                state.cached = action.payload.cached;

                // Filter to show only selected columns
                const { visibleColumns, visibleData } = filterVisibleData(
                    state.allColumns,
                    state.allData,
                    state.selectedDimensions,
                    state.selectedMetrics
                );

                state.columns = visibleColumns;
                state.data = visibleData;
                state.columnTypes = visibleColumns.map(col => {
                    const idx = state.allColumns.indexOf(col);
                    return idx >= 0 ? state.allColumnTypes[idx] : 'varchar';
                });

                // Track loaded range
                state.loadedRanges = [{ start: 0, end: action.payload.data.length }];

                console.log(`[DataGrid] Initial load complete: ${action.payload.data.length} rows, showing ${visibleColumns.length} columns`);
            })
            .addCase(fetchInitialData.rejected, (state, action) => {
                state.isLoading = false;
                state.needsDataRefresh = false;
                const errorMsg = action.error.message;
                if (errorMsg !== 'Request cancelled') {
                    state.error = errorMsg ?? 'Failed to fetch data';
                }
            })

            // Fetch Data Range (prefetch or load more)
            .addCase(fetchDataRange.pending, (state, action) => {
                if (action.meta.arg.isPrefetch) {
                    state.isPrefetching = true;
                } else {
                    state.isLoading = true;
                }
            })
            .addCase(fetchDataRange.fulfilled, (state, action) => {
                if (!action.payload) {
                    state.isPrefetching = false;
                    return;
                }

                if (action.payload.isPrefetch) {
                    state.isPrefetching = false;
                } else {
                    state.isLoading = false;
                }

                // Append new data to allData
                const newData = action.payload.data;
                const offset = action.payload.offset;

                state.allData = [...state.allData, ...newData];

                // Re-filter visible data
                const { visibleColumns, visibleData } = filterVisibleData(
                    state.allColumns,
                    state.allData,
                    state.selectedDimensions,
                    state.selectedMetrics
                );

                state.columns = visibleColumns;
                state.data = visibleData;
                state.columnTypes = visibleColumns.map(col => {
                    const idx = state.allColumns.indexOf(col);
                    return idx >= 0 ? state.allColumnTypes[idx] : 'varchar';
                });

                // Update loaded ranges
                state.loadedRanges.push({ start: offset, end: offset + newData.length });
                state.loadedRanges = mergeRanges(state.loadedRanges);

                // Update totalRows if changed
                state.totalRows = action.payload.totalRows;

                // Evict old data if cache too large
                if (state.allData.length > MAX_CACHED_ROWS) {
                    const excessRows = state.allData.length - MAX_CACHED_ROWS;
                    state.allData = state.allData.slice(excessRows);

                    // Re-filter after eviction
                    const filtered = filterVisibleData(
                        state.allColumns,
                        state.allData,
                        state.selectedDimensions,
                        state.selectedMetrics
                    );
                    state.data = filtered.visibleData;

                    // Adjust loaded ranges
                    state.loadedRanges = state.loadedRanges.map(range => ({
                        start: Math.max(0, range.start - excessRows),
                        end: Math.max(0, range.end - excessRows),
                    })).filter(range => range.end > range.start);

                    console.log(`[DataGrid] Evicted ${excessRows} rows to maintain cache limit`);
                }

                console.log(`[DataGrid] Loaded range ${offset}-${offset + newData.length}, total cached: ${state.allData.length}`);
            })
            .addCase(fetchDataRange.rejected, (state, action) => {
                state.isPrefetching = false;
                state.isLoading = false;
                const errorMsg = action.error.message;
                if (errorMsg !== 'Request cancelled') {
                    console.error('[DataGrid] Fetch range failed:', errorMsg);
                }
            });
    },
});

export const {
    setSelectedDimensions,
    addDimension,
    removeDimension,
    setSelectedMetrics,
    toggleMetric,
    setFilters,
    addFilter,
    removeFilter,
    setSort,
    setSearchText,
    setComparison,
    clearError,
    updateScrollPosition,
    markRefreshComplete,
} = dataGridSlice.actions;

// Selectors
export const selectDataGridState = (state: { dataGrid: PrefetchState }) => state.dataGrid;
export const selectNeedsDataRefresh = (state: { dataGrid: PrefetchState }) => state.dataGrid.needsDataRefresh;
export const selectIsLoadingAny = (state: { dataGrid: PrefetchState }) =>
    state.dataGrid.isLoading || state.dataGrid.isPrefetching;
export const selectHasMoreData = (state: { dataGrid: PrefetchState }) =>
    state.dataGrid.allData.length < state.dataGrid.totalRows;

export default dataGridSlice.reducer;
