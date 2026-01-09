import React, { useEffect, useMemo, useCallback } from 'react';
import { VirtualTable } from '../VirtualTable';
import type { VirtualTableColumn } from '../VirtualTable';
import { DataGridToolbar } from './DataGridToolbar';
import { DrillDownSelector } from './DrillDownSelector';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import {
    fetchMetadata,
    fetchDataRaw,
    loadMoreData,
    setSelectedDimensions,
    setSort
} from '../../store/dataGridSlice';
import './DataGrid.css';

// =============================================================================
// DataGrid Component - Wrapper for VirtualTable with Redux integration
// =============================================================================

// Extended state type for infinite scroll
interface ExtendedState {
    dataGrid: {
        selectedDimensions: string[];
        selectedMetrics: string[];
        sort: { column: string; direction: 'asc' | 'desc' }[];
        isLoading: boolean;
        isLoadingMore: boolean;
        hasMoreData: boolean;
        error: string | null;
        metadata: {
            dimensions: { name: string; label: string; type: string }[];
            metrics: { name: string; label: string; type: string; aggregation: string }[]
        } | null;
        columns: string[];
        columnTypes: string[];
        data: (string | number | null)[][];
        totalRows: number;
        queryTimeMs: number;
        cached: boolean;
    };
}

export const DataGrid: React.FC = () => {
    const dispatch = useAppDispatch();
    const {
        selectedDimensions,
        selectedMetrics,
        sort,
        isLoading,
        isLoadingMore,
        hasMoreData,
        error,
        metadata,
        columns,
        columnTypes,
        data,
        totalRows,
        queryTimeMs,
        cached,
    } = useAppSelector((state) => (state as unknown as ExtendedState).dataGrid);

    const [showDrillDown, setShowDrillDown] = React.useState(false);

    // Fetch metadata on mount
    useEffect(() => {
        console.log('[DataGrid] Fetching metadata...');
        dispatch(fetchMetadata());
    }, [dispatch]);

    // Fetch data when dimensions, metrics, or sort changes
    useEffect(() => {
        if (metadata && selectedDimensions.length > 0 && selectedMetrics.length > 0) {
            console.log('[DataGrid] Fetching initial data...', { selectedDimensions, selectedMetrics });
            dispatch(fetchDataRaw({})); // Use default PAGE_SIZE from slice
        }
    }, [dispatch, metadata, selectedDimensions, selectedMetrics, sort]);

    // Build column definitions for VirtualTable
    const tableColumns: VirtualTableColumn[] = useMemo(() => {
        if (columns.length === 0 || !metadata) return [];

        return columns.map((colName, index) => {
            // Find column info from metadata
            const dimInfo = metadata.dimensions.find(d => d.name === colName);
            const metricInfo = metadata.metrics.find(m => m.name === colName);

            return {
                name: colName,
                label: dimInfo?.label || metricInfo?.label || colName,
                type: columnTypes[index] || 'varchar',
                width: dimInfo ? 160 : 130,
            };
        });
    }, [columns, columnTypes, metadata]);

    // Handle sort
    const handleSort = useCallback((column: string, direction: 'asc' | 'desc') => {
        dispatch(setSort([{ column, direction }]));
    }, [dispatch]);

    // Handle load more (infinite scroll)
    const handleLoadMore = useCallback(() => {
        console.log('[DataGrid] Loading more data...');
        dispatch(loadMoreData());
    }, [dispatch]);

    // Handle drill-down apply
    const handleDrillDownApply = useCallback((dimensions: string[]) => {
        dispatch(setSelectedDimensions(dimensions));
        setShowDrillDown(false);
    }, [dispatch]);

    // Get current sort
    const currentSortColumn = sort[0]?.column;
    const currentSortDirection = sort[0]?.direction;

    // Show loading while fetching metadata
    if (!metadata) {
        return (
            <div className="data-grid-wrapper">
                <div className="loading-container">
                    <div className="loading-spinner" />
                    <p>Loading table schema...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="data-grid-wrapper">
            {/* Toolbar */}
            <DataGridToolbar
                onDrillDownClick={() => setShowDrillDown(true)}
                totalRows={totalRows}
                queryTimeMs={queryTimeMs}
                cached={cached}
                isLoading={isLoading}
            />

            {/* Error message */}
            {error && (
                <div className="error-banner">
                    <span>⚠️ {error}</span>
                    <button onClick={() => dispatch(fetchDataRaw({}))}>Retry</button>
                </div>
            )}

            {/* Virtual Table */}
            <div className="data-grid-container">
                <VirtualTable
                    columns={tableColumns}
                    data={data}
                    dimensionCount={selectedDimensions.length}
                    totalRows={totalRows}
                    rowHeight={40}
                    onSort={handleSort}
                    onLoadMore={handleLoadMore}
                    sortColumn={currentSortColumn}
                    sortDirection={currentSortDirection}
                    isLoading={isLoading}
                    isLoadingMore={isLoadingMore}
                    hasMoreData={hasMoreData}
                />
            </div>

            {/* Drill-Down Selector Modal */}
            {showDrillDown && metadata && (
                <DrillDownSelector
                    availableDimensions={metadata.dimensions as unknown as import('../../types/data.types').DimensionColumn[]}
                    selectedDimensions={selectedDimensions}
                    onApply={handleDrillDownApply}
                    onClose={() => setShowDrillDown(false)}
                />
            )}
        </div>
    );
};

export default DataGrid;
