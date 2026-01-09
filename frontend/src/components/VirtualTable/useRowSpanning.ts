import { useMemo } from 'react';
import type { RowSpanMap } from '../../types/data.types';

// =============================================================================
// Row Spanning Hook - Calculates merged cells for Power BI matrix-style display
// =============================================================================

export interface RowSpanConfig {
    data: (string | number | null)[][];
    dimensionCount: number; // Number of dimension columns to merge
}

export interface RowSpanResult {
    spanMap: RowSpanMap;
    shouldRender: (rowIndex: number, colIndex: number) => boolean;
    getRowSpan: (rowIndex: number, colIndex: number) => number;
}

export function useRowSpanning({ data, dimensionCount }: RowSpanConfig): RowSpanResult {
    const spanMap = useMemo(() => {
        const map: RowSpanMap = {};

        if (data.length === 0 || dimensionCount === 0) {
            return map;
        }

        // For each dimension column (left to right)
        for (let colIndex = 0; colIndex < dimensionCount; colIndex++) {
            let spanStart = 0;
            let currentValue = data[0]?.[colIndex];

            for (let rowIndex = 1; rowIndex <= data.length; rowIndex++) {
                const value = rowIndex < data.length ? data[rowIndex]?.[colIndex] : null;
                const prevColumnsMatch = colIndex === 0 ||
                    checkPrevColumnsMatch(data, spanStart, rowIndex, colIndex);

                // If value changed or previous columns don't match or end of data
                if (value !== currentValue || !prevColumnsMatch || rowIndex === data.length) {
                    const span = rowIndex - spanStart;

                    // Only store if span > 1 (optimization)
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
    }, [data, dimensionCount]);

    // Check if a cell should be rendered (first in span group)
    const shouldRender = (rowIndex: number, colIndex: number): boolean => {
        if (colIndex >= dimensionCount) return true; // Metrics always render

        // Check if this row is part of a span started earlier
        for (let r = rowIndex - 1; r >= 0; r--) {
            const spanInfo = spanMap[`${r}-${colIndex}`];
            if (spanInfo && r + spanInfo.span > rowIndex) {
                return false; // Part of earlier span, don't render
            }
            // Check if values differ
            if (data[r]?.[colIndex] !== data[rowIndex]?.[colIndex]) {
                break;
            }
        }
        return true;
    };

    // Get row span for a cell
    const getRowSpan = (rowIndex: number, colIndex: number): number => {
        const spanInfo = spanMap[`${rowIndex}-${colIndex}`];
        return spanInfo?.span || 1;
    };

    return { spanMap, shouldRender, getRowSpan };
}

// Helper: Check if all previous dimension columns match between rows
function checkPrevColumnsMatch(
    data: (string | number | null)[][],
    row1: number,
    row2: number,
    upToCol: number
): boolean {
    for (let c = 0; c < upToCol; c++) {
        if (data[row1]?.[c] !== data[row2]?.[c]) {
            return false;
        }
    }
    return true;
}
