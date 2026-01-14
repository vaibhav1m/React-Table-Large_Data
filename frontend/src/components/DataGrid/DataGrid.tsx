import React, { useEffect, useMemo, useCallback } from 'react';
import { VirtualTable } from '../VirtualTable';
import type { VirtualTableColumn } from '../VirtualTable';
import { DataGridToolbar } from './DataGridToolbar';
import { DrillDownSelector } from './DrillDownSelector';
import { BrandFilter } from './BrandFilter';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import {
    fetchMetadata,
    fetchInitialData,
    fetchDataRange,
    setSelectedDimensions,
    setSort,
    selectHasMoreData,
} from '../../store/dataGridSlice';
import './DataGrid.css';

// =============================================================================
// DataGrid Component - Hybrid prefetching with local metrics filtering
// =============================================================================

interface ExtendedState {
    dataGrid: {
        selectedDimensions: string[];
        selectedMetrics: string[];
        sort: { column: string; direction: 'asc' | 'desc' }[];
        isLoading: boolean;
        isPrefetching: boolean;
        error: string | null;
        metadata: {
            dimensions: { name: string; label: string; type: string }[];
            metrics: { name: string; label: string; type: string; aggregation: string }[];
        } | null;
        columns: string[];
        columnTypes: string[];
        data: (string | number | null)[][];
        allData: (string | number | null)[][];
        totalRows: number;
        queryTimeMs: number;
        cached: boolean;
        needsDataRefresh: boolean;
        searchText: string;
        filters: { column: string; operator: string; value: unknown }[];
        comparison: unknown;
    };
}

// Batch size for loading more data
const BATCH_SIZE = 2000;

export const DataGrid: React.FC = () => {
    const dispatch = useAppDispatch();
    const {
        selectedDimensions,
        selectedMetrics,
        sort,
        isLoading,
        isPrefetching,
        error,
        metadata,
        columns,
        columnTypes,
        data,
        allData,
        totalRows,
        queryTimeMs,
        cached,
        needsDataRefresh,
    } = useAppSelector((state) => (state as unknown as ExtendedState).dataGrid);

    const hasMoreData = useAppSelector(selectHasMoreData);

    const [showDrillDown, setShowDrillDown] = React.useState(false);

    // Fetch metadata on mount
    useEffect(() => {
        console.log('[DataGrid] Fetching metadata...');
        dispatch(fetchMetadata());
    }, [dispatch]);

    // Fetch data when needsDataRefresh is true
    useEffect(() => {
        if (metadata && needsDataRefresh && selectedDimensions.length > 0) {
            console.log('[DataGrid] Data refresh needed, fetching...');
            dispatch(fetchInitialData());
        }
    }, [dispatch, metadata, needsDataRefresh, selectedDimensions]);

    // Build column definitions for VirtualTable
    const tableColumns: VirtualTableColumn[] = useMemo(() => {
        if (columns.length === 0 || !metadata) return [];

        return columns.map((colName, index) => {
            const dimInfo = metadata.dimensions.find((d) => d.name === colName);
            const metricInfo = metadata.metrics.find((m) => m.name === colName);

            // Handle comparison column names
            let label = dimInfo?.label || metricInfo?.label || colName;
            let isComparisonCol = false;

            if (!dimInfo && !metricInfo) {
                // Check if it's a comparison column
                const suffixes = ['_curr', '_comp', '_diff', '_diff_pct'];
                for (const suffix of suffixes) {
                    if (colName.endsWith(suffix)) {
                        const baseMetricName = colName.slice(0, -suffix.length);
                        const baseMetric = metadata.metrics.find(m => m.name === baseMetricName);
                        if (baseMetric) {
                            isComparisonCol = true;
                            const suffixLabel = suffix === '_curr' ? 'Current'
                                : suffix === '_comp' ? 'Prior'
                                    : suffix === '_diff' ? 'Diff'
                                        : 'Diff %';
                            label = `${baseMetric.label} (${suffixLabel})`;
                        }
                        break;
                    }
                }
            }

            return {
                name: colName,
                label,
                type: columnTypes[index] || 'varchar',
                width: dimInfo ? 160 : (isComparisonCol ? 120 : 130),
            };
        });
    }, [columns, columnTypes, metadata]);

    // Handle sort - triggers new server query
    const handleSort = useCallback(
        (column: string, direction: 'asc' | 'desc') => {
            console.log('[DataGrid] Sort changed:', column, direction);
            dispatch(setSort([{ column, direction }]));
        },
        [dispatch]
    );

    // Handle load more - fetch next batch
    const handleLoadMore = useCallback(() => {
        if (isLoading || isPrefetching) return;

        const nextOffset = allData.length;
        if (nextOffset >= totalRows) return;

        console.log('[DataGrid] Loading more data from offset:', nextOffset);
        dispatch(fetchDataRange({ offset: nextOffset, limit: BATCH_SIZE, isPrefetch: false }));
    }, [dispatch, allData.length, totalRows, isLoading, isPrefetching]);

    // Handle scroll progress (for prefetch detection)
    const handleScrollProgressCallback = useCallback((_progress: number, _endIndex: number) => {
        // Prefetch logic is handled by VirtualTable's onLoadMore
    }, []);

    // Handle drill-down apply
    const handleDrillDownApply = useCallback(
        (dimensions: string[]) => {
            dispatch(setSelectedDimensions(dimensions));
            setShowDrillDown(false);
        },
        [dispatch]
    );

    // Get current sort
    const currentSortColumn = sort[0]?.column;
    const currentSortDirection = sort[0]?.direction;

    // Show loading only on initial load
    if (!metadata || (isLoading && data.length === 0)) {
        return (
            <div className="data-grid-wrapper">
                <div className="loading-container">
                    <div className="loading-spinner" />
                    <p>
                        {!metadata
                            ? 'Loading table schema...'
                            : 'Loading data...'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="data-grid-wrapper">
            {/* Brand Filter at top */}
            <BrandFilter />

            {/* Toolbar */}
            <DataGridToolbar
                onDrillDownClick={() => setShowDrillDown(true)}
                totalRows={totalRows}
                queryTimeMs={queryTimeMs}
                cached={cached}
                isLoading={isLoading}
            />

            {/* Status indicator */}
            <div className="duckdb-indicator">
                📊 {allData.length.toLocaleString()} of {totalRows.toLocaleString()} rows loaded
                {' • '}{columns.length} columns shown (of {selectedDimensions.length} dims + {selectedMetrics.length} metrics)
                {queryTimeMs > 0 && ` • Query: ${queryTimeMs.toFixed(0)}ms`}
                {isPrefetching && ' • Prefetching...'}
            </div>

            {/* Error message */}
            {error && (
                <div className="error-banner">
                    <span>⚠️ {error}</span>
                    <button onClick={() => dispatch(fetchInitialData())}>Retry</button>
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
                    onScrollProgress={handleScrollProgressCallback}
                    sortColumn={currentSortColumn}
                    sortDirection={currentSortDirection}
                    isLoading={isLoading && data.length > 0}
                    isLoadingMore={isPrefetching}
                    hasMoreData={hasMoreData}
                />
            </div>

            {/* Drill-Down Selector Modal */}
            {showDrillDown && metadata && (
                <DrillDownSelector
                    availableDimensions={
                        metadata.dimensions as unknown as import('../../types/data.types').DimensionColumn[]
                    }
                    selectedDimensions={selectedDimensions}
                    onApply={handleDrillDownApply}
                    onClose={() => setShowDrillDown(false)}
                />
            )}
        </div>
    );
};

export default DataGrid;
