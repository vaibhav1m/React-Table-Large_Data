import { useMemo } from 'react';
import type { RowSpanMap } from '../../types/data.types';

// =============================================================================
// Row Spanning Hook - Calculates merged cells for Power BI matrix-style display
// =============================================================================

// Columns that should have row grouping applied
const SPANNING_COLUMNS = [
    'principal_category',
    'main_category',
    'category',
    'sub_category',
];

export interface RowSpanConfig {
    data: (string | number | null)[][];
    dimensionCount: number;
    columnNames: string[];
}

export interface GroupInfo {
    value: string | number | null;
    startRow: number;
    rowCount: number;
}

export interface RowSpanResult {
    spanMap: RowSpanMap;
    shouldRender: (rowIndex: number, colIndex: number) => boolean;
    getRowSpan: (rowIndex: number, colIndex: number) => number;
    getGroupInfo: (rowIndex: number, colIndex: number) => GroupInfo | null;
    isGroupingColumn: (colIndex: number) => boolean;
}

export function useRowSpanning({ data, dimensionCount, columnNames }: RowSpanConfig): RowSpanResult {
    // Determine which column indices should have grouping
    const spanningColIndices = useMemo(() => {
        const indices: Set<number> = new Set();
        columnNames.forEach((name, index) => {
            if (SPANNING_COLUMNS.includes(name.toLowerCase()) && index < dimensionCount) {
                indices.add(index);
            }
        });
        return indices;
    }, [columnNames, dimensionCount]);

    // Build a map of row -> colIndex -> group info
    const groupMap = useMemo(() => {
        const map: Map<string, GroupInfo> = new Map();

        if (data.length === 0 || spanningColIndices.size === 0) {
            return map;
        }

        // For each spanning column, find groups
        for (const colIndex of spanningColIndices) {
            let groupStart = 0;
            let currentValue = data[0]?.[colIndex];

            for (let rowIndex = 1; rowIndex <= data.length; rowIndex++) {
                const value = rowIndex < data.length ? data[rowIndex]?.[colIndex] : null;

                // Check if all previous spanning columns match
                const prevColumnsMatch = checkPrevSpanningColumnsMatch(
                    data, groupStart, rowIndex, colIndex, spanningColIndices
                );

                if (value !== currentValue || !prevColumnsMatch || rowIndex === data.length) {
                    const rowCount = rowIndex - groupStart;

                    // Store group info for each row in this group
                    for (let r = groupStart; r < rowIndex; r++) {
                        map.set(`${r}-${colIndex}`, {
                            value: currentValue,
                            startRow: groupStart,
                            rowCount,
                        });
                    }

                    groupStart = rowIndex;
                    currentValue = value;
                }
            }
        }

        return map;
    }, [data, spanningColIndices]);

    const spanMap = useMemo(() => {
        const map: RowSpanMap = {};

        if (data.length === 0 || spanningColIndices.size === 0) {
            return map;
        }

        // Calculate span map for shouldRender logic
        for (const colIndex of spanningColIndices) {
            let spanStart = 0;
            let currentValue = data[0]?.[colIndex];

            for (let rowIndex = 1; rowIndex <= data.length; rowIndex++) {
                const value = rowIndex < data.length ? data[rowIndex]?.[colIndex] : null;
                const prevColumnsMatch = checkPrevSpanningColumnsMatch(
                    data, spanStart, rowIndex, colIndex, spanningColIndices
                );

                if (value !== currentValue || !prevColumnsMatch || rowIndex === data.length) {
                    const span = rowIndex - spanStart;
                    if (span > 1) {
                        map[`${spanStart}-${colIndex}`] = {
                            rowIndex: spanStart,
                            colIndex,
                            span,
                        };
                    }
                    spanStart = rowIndex;
                    currentValue = value;
                }
            }
        }

        return map;
    }, [data, spanningColIndices]);

    const shouldRender = (rowIndex: number, colIndex: number): boolean => {
        if (!spanningColIndices.has(colIndex)) return true;
        if (colIndex >= dimensionCount) return true;

        // For grouping columns, we render content in every row but with sticky styling
        // Return true for the first row of the group
        const groupInfo = groupMap.get(`${rowIndex}-${colIndex}`);
        if (groupInfo) {
            return rowIndex === groupInfo.startRow;
        }
        return true;
    };

    const getRowSpan = (rowIndex: number, colIndex: number): number => {
        if (!spanningColIndices.has(colIndex)) return 1;

        const spanInfo = spanMap[`${rowIndex}-${colIndex}`];
        return spanInfo?.span || 1;
    };

    const getGroupInfo = (rowIndex: number, colIndex: number): GroupInfo | null => {
        return groupMap.get(`${rowIndex}-${colIndex}`) || null;
    };

    const isGroupingColumn = (colIndex: number): boolean => {
        return spanningColIndices.has(colIndex);
    };

    return { spanMap, shouldRender, getRowSpan, getGroupInfo, isGroupingColumn };
}

function checkPrevSpanningColumnsMatch(
    data: (string | number | null)[][],
    row1: number,
    row2: number,
    upToCol: number,
    spanningColIndices: Set<number>
): boolean {
    for (let c = 0; c < upToCol; c++) {
        if (spanningColIndices.has(c)) {
            if (data[row1]?.[c] !== data[row2]?.[c]) {
                return false;
            }
        }
    }
    return true;
}
