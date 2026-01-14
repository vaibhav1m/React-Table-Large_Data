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
    onScrollProgress?: (progress: number, endIndex: number) => void;
    sortColumn?: string;
    sortDirection?: 'asc' | 'desc';
    isLoading?: boolean;
    isLoadingMore?: boolean;
    hasMoreData?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

const getColWidth = (col: VirtualTableColumn, i: number, dimCount: number): number =>
    col.width || (i < dimCount ? 180 : 130);

const fmtCache = new Map<string, string>();

const fmt = (v: string | number | null, t: string): string => {
    if (v === null || v === undefined) return '-';
    const k = `${t}:${v}`;
    const cached = fmtCache.get(k);
    if (cached) return cached;

    let s: string;
    if (typeof v === 'number') {
        s = (t.includes('double') || t.includes('currency'))
            ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v)
            : new Intl.NumberFormat('en-IN').format(v);
    } else {
        s = String(v);
    }

    if (fmtCache.size > 10000) fmtCache.clear();
    fmtCache.set(k, s);
    return s;
};

// =============================================================================
// Sticky Group Label - Floats at top of viewport within group bounds
// =============================================================================

interface StickyLabelProps {
    value: string | number | null;
    type: string;
    colWidth: number;
    colLeft: number;
    groupStartY: number;  // Y position where group starts
    groupEndY: number;    // Y position where group ends
    scrollTop: number;    // Current scroll position
    rowHeight: number;
    viewportHeight: number; // Actual viewport height
}

const StickyLabel = memo<StickyLabelProps>(({
    value, type, colWidth, colLeft, groupStartY, groupEndY, scrollTop, rowHeight, viewportHeight
}) => {
    // Calculate where the label should appear
    // It should stick to the top of the viewport but:
    // - Not go above the group start
    // - Not go below the group end - rowHeight (so it's visible)

    const minY = groupStartY;
    const maxY = groupEndY - rowHeight;
    const stickyY = Math.max(minY, Math.min(scrollTop, maxY));

    // Don't show if the group is entirely above or below viewport
    // Use actual viewport height instead of hardcoded value
    if (groupEndY <= scrollTop || groupStartY >= scrollTop + viewportHeight) {
        return null;
    }

    return (
        <span
            className="sticky-lbl"
            style={{
                position: 'absolute',
                top: stickyY,
                // colLeft is relative to content, not viewport - no scroll adjustment needed
                left: colLeft,
                width: colWidth,
                height: rowHeight,
                zIndex: 60, // Higher z-index to ensure visibility above rows
            }}
        >
            {fmt(value, type)}
        </span>
    );
});
StickyLabel.displayName = 'StickyLabel';

// =============================================================================
// Row Component - Cells without text for grouped columns (labels float above)
// =============================================================================

interface RowProps {
    idx: number;
    row: (string | number | null)[];
    cols: VirtualTableColumn[];
    h: number;
    dimCount: number;
    getGrp: (r: number, c: number) => { value: string | number | null; startRow: number; rowCount: number } | null;
    isGrpCol: (c: number) => boolean;
    w: number;
}

const Row = memo<RowProps>(({ idx, row, cols, h, dimCount, getGrp, isGrpCol, w }) => (
    <span className="vrow" style={{ height: h, width: w }}>
        {cols.map((col, ci) => {
            const cw = getColWidth(col, ci, dimCount);
            const isDim = ci < dimCount;
            const isGrp = isGrpCol(ci);
            const grp = isGrp ? getGrp(idx, ci) : null;
            const val = grp?.value ?? row[ci];
            const isNum = typeof val === 'number';
            const isFirst = grp ? idx === grp.startRow : true;
            const isLast = grp ? idx === grp.startRow + grp.rowCount - 1 : true;

            return (
                <span
                    key={col.name}
                    className={`vc${isDim ? ' d' : ' m'}${isNum ? ' n' : ''}${isGrp ? ' g' : ''}${isFirst ? ' gs' : ''}${isLast ? ' ge' : ''}`}
                    style={{ width: cw }}
                    title={String(val ?? '')}
                >
                    {/* For grouped columns, text is rendered by floating StickyLabel */}
                    {!isGrp && fmt(val, col.type)}
                </span>
            );
        })}
    </span>
));
Row.displayName = 'Row';

// =============================================================================
// Header Component
// =============================================================================

interface HeaderProps {
    cols: VirtualTableColumn[];
    dimCount: number;
    onSort?: (col: string, dir: 'asc' | 'desc') => void;
    sortCol?: string;
    sortDir?: 'asc' | 'desc';
    w: number;
    scrollX: number;
}

const Header = memo<HeaderProps>(({ cols, dimCount, onSort, sortCol, sortDir, w, scrollX }) => (
    <span className="vhw">
        <span className="vh" style={{ width: w, transform: `translateX(-${scrollX}px)` }}>
            {cols.map((col, i) => {
                const cw = getColWidth(col, i, dimCount);
                const sorted = sortCol === col.name;
                return (
                    <span
                        key={col.name}
                        className={`vhc${i < dimCount ? ' d' : ''}${sorted ? ' s' : ''}`}
                        style={{ width: cw }}
                        onClick={() => onSort?.(col.name, sortCol === col.name && sortDir === 'asc' ? 'desc' : 'asc')}
                    >
                        <span className="hl">{col.label}</span>
                        {sorted && <span className="si">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </span>
                );
            })}
        </span>
    </span>
));
Header.displayName = 'Header';

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
    const [cHeight, setCHeight] = useState(600);
    const [scrollX, setScrollX] = useState(0);
    const [scrollY, setScrollY] = useState(0);
    const loadTriggered = useRef(false);

    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(es => setCHeight(es[0].contentRect.height));
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    const w = useMemo(() => columns.reduce((s, c, i) => s + getColWidth(c, i, dimensionCount), 0), [columns, dimensionCount]);

    // Calculate column left positions
    const colLefts = useMemo(() => {
        const lefts: number[] = [];
        let left = 0;
        for (let i = 0; i < columns.length; i++) {
            lefts.push(left);
            left += getColWidth(columns[i], i, dimensionCount);
        }
        return lefts;
    }, [columns, dimensionCount]);

    const { startIndex, endIndex, offsetTop, totalHeight, handleScroll: updateScroll } = useVirtualScroll({
        totalRows: data.length,
        rowHeight,
        containerHeight: cHeight - 84,
        overscan: 10,
    });

    const { getGroupInfo, isGroupingColumn } = useRowSpanning({ data, dimensionCount, columnNames: columns.map(c => c.name) });

    useEffect(() => { loadTriggered.current = false; }, [data.length]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const t = e.target as HTMLDivElement;
        setScrollX(t.scrollLeft);
        setScrollY(t.scrollTop);
        updateScroll(t.scrollTop);
        onScroll?.(t.scrollTop, t.scrollLeft);

        const prog = data.length > 0 ? endIndex / data.length : 0;
        onScrollProgress?.(prog, endIndex);

        if (prog >= 0.7 && hasMoreData && !isLoadingMore && !isLoading && !loadTriggered.current && onLoadMore) {
            loadTriggered.current = true;
            onLoadMore();
        }

        const distBottom = t.scrollHeight - t.scrollTop - t.clientHeight;
        if (distBottom < 500 && hasMoreData && !isLoadingMore && !isLoading && !loadTriggered.current && onLoadMore) {
            loadTriggered.current = true;
            onLoadMore();
        }
    }, [updateScroll, onScroll, onScrollProgress, hasMoreData, isLoadingMore, isLoading, onLoadMore, data.length, endIndex]);

    const visRows = useMemo(() => data.slice(startIndex, endIndex), [data, startIndex, endIndex]);

    // Calculate visible sticky labels for grouped columns
    const stickyLabels = useMemo(() => {
        const labels: Array<{
            key: string;
            value: string | number | null;
            type: string;
            colWidth: number;
            colLeft: number;
            groupStartY: number;
            groupEndY: number;
        }> = [];

        // Find grouped columns and their current visible groups
        columns.forEach((col, colIndex) => {
            if (!isGroupingColumn(colIndex)) return;

            const colWidth = getColWidth(col, colIndex, dimensionCount);
            const colLeft = colLefts[colIndex];

            // Track which groups we've already added
            const addedGroups = new Set<string>();

            // Check each visible row for its group
            for (let i = startIndex; i < endIndex; i++) {
                const grp = getGroupInfo(i, colIndex);
                if (!grp) continue;

                const groupKey = `${colIndex}-${grp.startRow}`;
                if (addedGroups.has(groupKey)) continue;
                addedGroups.add(groupKey);

                labels.push({
                    key: groupKey,
                    value: grp.value,
                    type: col.type,
                    colWidth,
                    colLeft,
                    groupStartY: grp.startRow * rowHeight,
                    groupEndY: (grp.startRow + grp.rowCount) * rowHeight,
                });
            }
        });

        return labels;
    }, [columns, dimensionCount, colLefts, startIndex, endIndex, getGroupInfo, isGroupingColumn, rowHeight]);

    return (
        <div className="vtc" ref={containerRef}>
            <Header cols={columns} dimCount={dimensionCount} onSort={onSort} sortCol={sortColumn} sortDir={sortDirection} w={w} scrollX={scrollX} />

            <div className="vtb" onScroll={handleScroll}>
                <div style={{ height: totalHeight, width: w, position: 'relative' }}>
                    {/* Visible rows */}
                    <div className="vrows" style={{ position: 'absolute', top: offsetTop, width: w }}>
                        {visRows.map((row, i) => (
                            <Row
                                key={startIndex + i}
                                idx={startIndex + i}
                                row={row}
                                cols={columns}
                                h={rowHeight}
                                dimCount={dimensionCount}
                                getGrp={getGroupInfo}
                                isGrpCol={isGroupingColumn}
                                w={w}
                            />
                        ))}
                    </div>

                    {/* Sticky group labels - float above rows */}
                    {stickyLabels.map(lbl => (
                        <StickyLabel
                            key={lbl.key}
                            value={lbl.value}
                            type={lbl.type}
                            colWidth={lbl.colWidth}
                            colLeft={lbl.colLeft}
                            groupStartY={lbl.groupStartY}
                            groupEndY={lbl.groupEndY}
                            scrollTop={scrollY}
                            rowHeight={rowHeight}
                            viewportHeight={cHeight - 84}
                        />
                    ))}

                    {isLoadingMore && (
                        <span className="lmi" style={{ position: 'absolute', bottom: 0, width: w }}>
                            <span className="spin sm" />Loading...
                        </span>
                    )}
                </div>
                {isLoading && <span className="lov"><span className="spin" /></span>}
                {!isLoading && data.length === 0 && <span className="emt">No data</span>}
            </div>

            <span className="vts">
                <span>{totalRows.toLocaleString()} rows</span>
                <span>Loaded: {data.length.toLocaleString()} | Showing: {startIndex + 1}-{Math.min(endIndex, data.length)}</span>
            </span>
        </div>
    );
};

export default VirtualTable;
