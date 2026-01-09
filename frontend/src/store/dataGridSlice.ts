import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { dataService } from '../services/api.service';
import type {
    DataGridState,
    Filter,
    SortConfig,
    ComparisonConfig,
    QueryRequest,
} from '../types/data.types';

// =============================================================================
// Initial State - Updated for columnar format with infinite scroll
// =============================================================================

interface ExtendedDataGridState extends DataGridState {
    isLoadingMore: boolean;
    hasMoreData: boolean;
    currentOffset: number;
}

const initialState: ExtendedDataGridState = {
    selectedDimensions: ['master_brand_id'], // Default to brand
    selectedMetrics: ['ads_spend', 'ads_sale', 'gross_sale'],
    filters: [],
    sort: [{ column: 'ads_spend', direction: 'desc' }],
    searchText: '',
    comparison: null,
    isLoading: false,
    isLoadingMore: false,
    hasMoreData: true,
    currentOffset: 0,
    error: null,
    metadata: null,
    columns: [],
    columnTypes: [],
    data: [],
    totalRows: 0,
    cached: false,
    queryTimeMs: 0,
};

// Page size for infinite scroll
const PAGE_SIZE = 500;

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

// Fetch initial data (resets offset)
export const fetchDataRaw = createAsyncThunk(
    'dataGrid/fetchDataRaw',
    async (params: { offset?: number; limit?: number } = {}, { getState }) => {
        const state = getState() as { dataGrid: ExtendedDataGridState };
        const { selectedDimensions, selectedMetrics, filters, sort, searchText, comparison } =
            state.dataGrid;

        const request: QueryRequest = {
            dimensions: selectedDimensions,
            metrics: selectedMetrics,
            filters,
            sort,
            offset: params.offset ?? 0,
            limit: params.limit ?? PAGE_SIZE,
            search: searchText || undefined,
            comparison: comparison ?? undefined,
        };

        const response = await dataService.queryRaw(request);
        return { ...response, isAppend: false };
    }
);

// Load more data (appends to existing data)
export const loadMoreData = createAsyncThunk(
    'dataGrid/loadMoreData',
    async (_, { getState }) => {
        const state = getState() as { dataGrid: ExtendedDataGridState };
        const {
            selectedDimensions, selectedMetrics, filters, sort,
            searchText, comparison, currentOffset, hasMoreData
        } = state.dataGrid;

        // Don't load if no more data
        if (!hasMoreData) {
            return null;
        }

        const newOffset = currentOffset + PAGE_SIZE;

        const request: QueryRequest = {
            dimensions: selectedDimensions,
            metrics: selectedMetrics,
            filters,
            sort,
            offset: newOffset,
            limit: PAGE_SIZE,
            search: searchText || undefined,
            comparison: comparison ?? undefined,
        };

        const response = await dataService.queryRaw(request);
        return { ...response, isAppend: true, newOffset };
    }
);

// Legacy object format fetch (for backwards compatibility)
export const fetchData = createAsyncThunk(
    'dataGrid/fetchData',
    async (params: { offset?: number; limit?: number } = {}, { getState }) => {
        const state = getState() as { dataGrid: ExtendedDataGridState };
        const { selectedDimensions, selectedMetrics, filters, sort, searchText, comparison } =
            state.dataGrid;

        const request: QueryRequest = {
            dimensions: selectedDimensions,
            metrics: selectedMetrics,
            filters,
            sort,
            offset: params.offset ?? 0,
            limit: params.limit ?? PAGE_SIZE,
            search: searchText || undefined,
            comparison: comparison ?? undefined,
        };

        const response = await dataService.query(request);

        // Convert to columnar format for state
        if (response.data.length > 0) {
            const columns = Object.keys(response.data[0]);
            const columnTypes = columns.map(() => 'varchar'); // Default type
            const data = response.data.map(row => columns.map(col => row[col] as string | number | null));

            return {
                columns,
                columnTypes,
                data,
                totalRows: response.totalRows,
                queryTimeMs: response.queryTimeMs,
                cached: response.cached,
            };
        }

        return {
            columns: [],
            columnTypes: [],
            data: [],
            totalRows: response.totalRows,
            queryTimeMs: response.queryTimeMs,
            cached: response.cached,
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
        setSelectedDimensions: (state, action: PayloadAction<string[]>) => {
            state.selectedDimensions = action.payload;
            // Reset pagination when dimensions change
            state.currentOffset = 0;
            state.hasMoreData = true;
        },
        addDimension: (state, action: PayloadAction<string>) => {
            if (!state.selectedDimensions.includes(action.payload)) {
                state.selectedDimensions.push(action.payload);
            }
        },
        removeDimension: (state, action: PayloadAction<string>) => {
            state.selectedDimensions = state.selectedDimensions.filter((d) => d !== action.payload);
        },
        setSelectedMetrics: (state, action: PayloadAction<string[]>) => {
            state.selectedMetrics = action.payload;
        },
        toggleMetric: (state, action: PayloadAction<string>) => {
            const index = state.selectedMetrics.indexOf(action.payload);
            if (index === -1) {
                state.selectedMetrics.push(action.payload);
            } else {
                state.selectedMetrics.splice(index, 1);
            }
        },
        setFilters: (state, action: PayloadAction<Filter[]>) => {
            state.filters = action.payload;
            // Reset pagination when filters change
            state.currentOffset = 0;
            state.hasMoreData = true;
        },
        addFilter: (state, action: PayloadAction<Filter>) => {
            state.filters.push(action.payload);
        },
        removeFilter: (state, action: PayloadAction<number>) => {
            state.filters.splice(action.payload, 1);
        },
        setSort: (state, action: PayloadAction<SortConfig[]>) => {
            state.sort = action.payload;
            // Reset pagination when sort changes
            state.currentOffset = 0;
            state.hasMoreData = true;
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
            // Fetch Data Raw (optimized columnar format - initial load)
            .addCase(fetchDataRaw.pending, (state) => {
                state.isLoading = true;
                state.error = null;
            })
            .addCase(fetchDataRaw.fulfilled, (state, action) => {
                state.isLoading = false;
                state.columns = action.payload.columns;
                state.columnTypes = action.payload.columnTypes;
                state.data = action.payload.data;
                state.totalRows = action.payload.totalRows;
                state.cached = action.payload.cached;
                state.queryTimeMs = action.payload.queryTimeMs;
                state.currentOffset = 0;
                state.hasMoreData = action.payload.data.length >= PAGE_SIZE;
            })
            .addCase(fetchDataRaw.rejected, (state, action) => {
                state.isLoading = false;
                const errorMsg = action.error.message;
                // Ignore cancelled requests
                if (errorMsg !== 'Request cancelled') {
                    state.error = errorMsg ?? 'Failed to fetch data';
                }
            })
            // Load More Data (infinite scroll - append)
            .addCase(loadMoreData.pending, (state) => {
                state.isLoadingMore = true;
            })
            .addCase(loadMoreData.fulfilled, (state, action) => {
                state.isLoadingMore = false;
                if (action.payload) {
                    // Append new data to existing data
                    state.data = [...state.data, ...action.payload.data];
                    state.currentOffset = action.payload.newOffset;
                    state.hasMoreData = action.payload.data.length >= PAGE_SIZE;
                    state.queryTimeMs = action.payload.queryTimeMs;
                }
            })
            .addCase(loadMoreData.rejected, (state, action) => {
                state.isLoadingMore = false;
                const errorMsg = action.error.message;
                if (errorMsg !== 'Request cancelled') {
                    state.error = errorMsg ?? 'Failed to load more data';
                }
            })
            // Fetch Data (legacy format, converted to columnar)
            .addCase(fetchData.pending, (state) => {
                state.isLoading = true;
                state.error = null;
            })
            .addCase(fetchData.fulfilled, (state, action) => {
                state.isLoading = false;
                state.columns = action.payload.columns;
                state.columnTypes = action.payload.columnTypes;
                state.data = action.payload.data;
                state.totalRows = action.payload.totalRows;
                state.cached = action.payload.cached;
                state.queryTimeMs = action.payload.queryTimeMs;
            })
            .addCase(fetchData.rejected, (state, action) => {
                state.isLoading = false;
                state.error = action.error.message ?? 'Failed to fetch data';
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
} = dataGridSlice.actions;

export default dataGridSlice.reducer;
