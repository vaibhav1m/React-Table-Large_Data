import React, { useRef, useCallback, useMemo, memo, useEffect, useState } from 'react';
import { useVirtualScroll } from './useVirtualScroll';
import { useRowSpanning } from './useRowSpanning';
import './VirtualTable.css';

// =============================================================================
// Types
// =============================================================================

export interface VirtualTableColumn {
    name: string;
    label: string;
    type: string;
    width?: number;
}

export interface VirtualTableProps {
    columns: VirtualTableColumn[];
    data: (string | number | null)[][];
    dimensionCount: number;
    totalRows: number;
    rowHeight?: number;
    onScroll?: (scrollTop: number, scrollLeft: number) => void;
    onSort?: (column: string, direction: 'asc' | 'desc') => void;
    onLoadMore?: () => void;
    onScrollProgress?: (progress: number, endIndex: number) => void; // For prefetch triggering
    sortColumn?: string;
    sortDirection?: 'asc' | 'desc';
    isLoading?: boolean;
    isLoadingMore?: boolean;
    hasMoreData?: boolean;
}

// =============================================================================
// Column Width Helper
// =============================================================================

function getColumnWidth(col: VirtualTableColumn, index: number, dimensionCount: number): number {
    if (col.width) return col.width;
    return index < dimensionCount ? 180 : 130; // Wider dimensions for readability
}

// =============================================================================
// Format Utilities with Memoization
// =============================================================================

const formatCache = new Map<string, string>();

function formatValue(value: string | number | null, type: string): string {
    if (value === null || value === undefined) return '-';

    const cacheKey = `${type}:${value}`;
    if (formatCache.has(cacheKey)) {
        return formatCache.get(cacheKey)!;
    }

    let formatted: string;

    if (typeof value === 'number') {
        if (type.includes('double') || type.includes('currency') || type === 'currency') {
            formatted = new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 0,
            }).format(value);
        } else {
            formatted = new Intl.NumberFormat('en-IN').format(value);
        }
    } else {
        formatted = String(value);
    }

    if (formatCache.size > 10000) {
        formatCache.clear();
    }
    formatCache.set(cacheKey, formatted);

    return formatted;
}

// =============================================================================
// Virtual Row Component (Memoized)
// =============================================================================

interface VirtualRowProps {
    rowIndex: number;
    rowData: (string | number | null)[];
    columns: VirtualTableColumn[];
    style: React.CSSProperties;
    dimensionCount: number;
    getGroupInfo: (rowIndex: number, colIndex: number) => { value: string | number | null; startRow: number; rowCount: number } | null;
    isGroupingColumn: (colIndex: number) => boolean;
    totalWidth: number;
    firstVisibleRowIndex: number; // The first visible row in the viewport
    rowHeight: number;
}

const VirtualRow = memo<VirtualRowProps>(({
    rowIndex,
    rowData,
    columns,
    style,
    dimensionCount,
    getGroupInfo,
    isGroupingColumn,
    totalWidth,
    firstVisibleRowIndex,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rowHeight: _rowHeight,
}) => {
    return (
        <div className="virtual-row" style={{ ...style, width: totalWidth, minWidth: totalWidth }}>
            {columns.map((col, colIndex) => {
                const colWidth = getColumnWidth(col, colIndex, dimensionCount);
                const isDimension = colIndex < dimensionCount;
                const isGrouped = isGroupingColumn(colIndex);

                // Get group info for this cell
                const groupInfo = isGrouped ? getGroupInfo(rowIndex, colIndex) : null;

                // For grouped columns, determine if THIS row should show the floating label
                // Show label if: this row is the first visible row within this group
                let showGroupLabel = false;
                if (isGrouped && groupInfo) {
                    const groupStartRow = groupInfo.startRow;

                    // Show label on the first visible row of the group
                    // If group starts above viewport, show on first visible row
                    // Otherwise show on the actual group start row
                    const effectiveFirstRow = Math.max(groupStartRow, firstVisibleRowIndex);
                    showGroupLabel = rowIndex === effectiveFirstRow;
                }

                // For grouped columns, show the value from the group
                const displayValue = groupInfo ? groupInfo.value : rowData[colIndex];
                const isNumber = typeof displayValue === 'number';

                // Check if this is the first row of a group
                const isFirstInGroup = groupInfo ? rowIndex === groupInfo.startRow : true;

                // Check if this is the last row of a group
                const isLastInGroup = groupInfo ? rowIndex === groupInfo.startRow + groupInfo.rowCount - 1 : true;

                return (
                    <div
                        key={col.name}
                        className={`virtual-cell ${isDimension ? 'dimension' : 'metric'} ${isNumber ? 'number' : ''} ${isGrouped ? 'grouped' : ''} ${isFirstInGroup ? 'group-start' : ''} ${isLastInGroup ? 'group-end' : ''} ${showGroupLabel ? 'show-label' : ''}`}
                        style={{
                            width: colWidth,
                            minWidth: colWidth,
                            maxWidth: colWidth,
                        }}
                        title={String(displayValue ?? '')}
                    >
                        {/* For grouped columns, show value only on the first visible row of the group */}
                        {isGrouped && groupInfo ? (
                            <span className={`cell-content ${showGroupLabel ? 'sticky-group-value' : 'hidden-label'}`}>
                                {showGroupLabel ? formatValue(groupInfo.value, col.type) : ''}
                            </span>
                        ) : (
                            <span className="cell-content">{formatValue(displayValue, col.type)}</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
});

VirtualRow.displayName = 'VirtualRow';

// =============================================================================
// Table Header Component
// =============================================================================

interface TableHeaderProps {
    columns: VirtualTableColumn[];
    dimensionCount: number;
    onSort?: (column: string, direction: 'asc' | 'desc') => void;
    sortColumn?: string;
    sortDirection?: 'asc' | 'desc';
    totalWidth: number;
    scrollLeft: number;
}

const TableHeader = memo<TableHeaderProps>(({
    columns,
    dimensionCount,
    onSort,
    sortColumn,
    sortDirection,
    totalWidth,
    scrollLeft,
}) => {
    const handleSort = (column: string) => {
        if (!onSort) return;
        const newDirection = sortColumn === column && sortDirection === 'asc' ? 'desc' : 'asc';
        onSort(column, newDirection);
    };

    return (
        <div className="virtual-header-wrapper">
            <div
                className="virtual-header"
                style={{
                    width: totalWidth,
                    minWidth: totalWidth,
                    transform: `translateX(-${scrollLeft}px)`,
                }}
            >
                {columns.map((col, index) => {
                    const isDimension = index < dimensionCount;
                    const isSorted = sortColumn === col.name;
                    const colWidth = getColumnWidth(col, index, dimensionCount);

                    return (
                        <div
                            key={col.name}
                            className={`virtual-header-cell ${isDimension ? 'dimension' : 'metric'} ${isSorted ? 'sorted' : ''}`}
                            style={{
                                width: colWidth,
                                minWidth: colWidth,
                                maxWidth: colWidth,
                            }}
                            onClick={() => handleSort(col.name)}
                        >
                            <span className="header-label">{col.label}</span>
                            {isSorted && (
                                <span className="sort-indicator">
                                    {sortDirection === 'asc' ? '▲' : '▼'}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

TableHeader.displayName = 'TableHeader';

// =============================================================================
// Main VirtualTable Component
// =============================================================================

export const VirtualTable: React.FC<VirtualTableProps> = ({
    columns,
    data,
    dimensionCount,
    totalRows,
    rowHeight = 40,
    onScroll,
    onSort,
    onLoadMore,
    onScrollProgress,
    sortColumn,
    sortDirection,
    isLoading = false,
    isLoadingMore = false,
    hasMoreData = true,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState(600);
    const [scrollLeft, setScrollLeft] = useState(0);
    const loadMoreTriggeredRef = useRef(false);

    // Observe container height
    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // Calculate total width
    const totalWidth = useMemo(() => {
        return columns.reduce((sum, col, index) => {
            return sum + getColumnWidth(col, index, dimensionCount);
        }, 0);
    }, [columns, dimensionCount]);

    // Virtual scroll state
    const {
        startIndex,
        endIndex,
        offsetTop,
        totalHeight,
        handleScroll: updateScrollState,
        actualFirstVisibleIndex,
    } = useVirtualScroll({
        totalRows: data.length,
        rowHeight,
        containerHeight: containerHeight - 48 - 36, // Subtract header and status bar height
        overscan: 10,
    });

    // Row grouping calculation for category columns
    const { getGroupInfo, isGroupingColumn } = useRowSpanning({
        data,
        dimensionCount,
        columnNames: columns.map(c => c.name),
    });

    // Reset load trigger when data changes
    useEffect(() => {
        loadMoreTriggeredRef.current = false;
    }, [data.length]);

    // Scroll handler with horizontal sync, prefetch trigger, and infinite scroll detection
    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement;
        const scrollTop = target.scrollTop;
        const scrollHeight = target.scrollHeight;
        const clientHeight = target.clientHeight;

        // Sync horizontal scroll with header
        setScrollLeft(target.scrollLeft);

        updateScrollState(scrollTop);
        onScroll?.(scrollTop, target.scrollLeft);

        // Calculate scroll progress (0-1) through loaded data
        const scrollProgress = data.length > 0 ? endIndex / data.length : 0;
        onScrollProgress?.(scrollProgress, endIndex);

        // Early prefetch trigger at 70% through loaded data
        const PREFETCH_THRESHOLD = 0.7;
        if (
            scrollProgress >= PREFETCH_THRESHOLD &&
            hasMoreData &&
            !isLoadingMore &&
            !isLoading &&
            !loadMoreTriggeredRef.current &&
            onLoadMore
        ) {
            loadMoreTriggeredRef.current = true;
            console.log('[VirtualTable] Prefetch triggered at', Math.round(scrollProgress * 100) + '% through loaded data');
            onLoadMore();
        }

        // Also check if near bottom as fallback
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const threshold = 500;

        if (
            distanceFromBottom < threshold &&
            hasMoreData &&
            !isLoadingMore &&
            !isLoading &&
            !loadMoreTriggeredRef.current &&
            onLoadMore
        ) {
            loadMoreTriggeredRef.current = true;
            console.log('[VirtualTable] Load more triggered at bottom, distance:', distanceFromBottom);
            onLoadMore();
        }
    }, [updateScrollState, onScroll, onScrollProgress, hasMoreData, isLoadingMore, isLoading, onLoadMore, data.length, endIndex]);

    // Get visible rows
    const visibleRows = useMemo(() => {
        return data.slice(startIndex, endIndex);
    }, [data, startIndex, endIndex]);

    return (
        <div className="virtual-table-container" ref={containerRef}>
            {/* Fixed Header - scrolls horizontally with body */}
            <TableHeader
                columns={columns}
                dimensionCount={dimensionCount}
                onSort={onSort}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                totalWidth={totalWidth}
                scrollLeft={scrollLeft}
            />

            {/* Scrollable Body */}
            <div
                ref={bodyRef}
                className="virtual-table-body"
                onScroll={handleScroll}
            >
                {/* Total height/width spacer */}
                <div style={{ height: totalHeight, width: totalWidth, minWidth: totalWidth, position: 'relative' }}>
                    {/* Visible rows container */}
                    <div
                        className="virtual-rows"
                        style={{
                            position: 'absolute',
                            top: offsetTop,
                            left: 0,
                            width: totalWidth,
                            minWidth: totalWidth,
                        }}
                    >
                        {visibleRows.map((rowData, index) => {
                            const actualRowIndex = startIndex + index;
                            return (
                                <VirtualRow
                                    key={actualRowIndex}
                                    rowIndex={actualRowIndex}
                                    rowData={rowData}
                                    columns={columns}
                                    style={{ height: rowHeight }}
                                    dimensionCount={dimensionCount}
                                    getGroupInfo={getGroupInfo}
                                    isGroupingColumn={isGroupingColumn}
                                    totalWidth={totalWidth}
                                    firstVisibleRowIndex={actualFirstVisibleIndex}
                                    rowHeight={rowHeight}
                                />
                            );
                        })}
                    </div>

                    {/* Load more indicator */}
                    {isLoadingMore && (
                        <div
                            className="load-more-indicator"
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: totalWidth,
                                height: 60,
                            }}
                        >
                            <div className="loading-spinner small" />
                            <span>Loading more rows...</span>
                        </div>
                    )}
                </div>

                {/* Loading overlay */}
                {isLoading && (
                    <div className="loading-overlay">
                        <div className="loading-spinner" />
                    </div>
                )}

                {/* Empty state */}
                {!isLoading && data.length === 0 && (
                    <div className="empty-state">No data available</div>
                )}
            </div>

            {/* Status bar */}
            <div className="virtual-table-status">
                <span>{totalRows.toLocaleString()} total rows</span>
                <span>
                    Loaded: {data.length.toLocaleString()} |
                    Showing: {startIndex + 1} - {Math.min(endIndex, data.length)}
                    {hasMoreData && !isLoadingMore && ' | Scroll for more'}
                    {isLoadingMore && ' | Loading...'}
                </span>
            </div>
        </div>
    );
};

export default VirtualTable;
