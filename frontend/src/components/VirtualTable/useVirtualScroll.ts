import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

// =============================================================================
// Virtual Scroll Hook - Calculates which rows to render
// =============================================================================

export interface VirtualScrollConfig {
    totalRows: number;
    rowHeight: number;
    containerHeight: number;
    overscan?: number; // Buffer rows above/below viewport
}

export interface VirtualScrollResult {
    startIndex: number;
    endIndex: number;
    visibleRows: number;
    offsetTop: number;
    totalHeight: number;
    handleScroll: (scrollTop: number) => void;
}

export function useVirtualScroll({
    totalRows,
    rowHeight,
    containerHeight,
    overscan = 10,
}: VirtualScrollConfig): VirtualScrollResult {
    const [scrollTop, setScrollTop] = useState(0);
    const tickingRef = useRef(false);

    // Calculate visible range
    const { startIndex, endIndex, visibleRows } = useMemo(() => {
        const visibleCount = Math.ceil(containerHeight / rowHeight);
        const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        const end = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan);

        return {
            startIndex: start,
            endIndex: end,
            visibleRows: visibleCount,
        };
    }, [scrollTop, containerHeight, rowHeight, totalRows, overscan]);

    // Offset for positioning visible rows
    const offsetTop = startIndex * rowHeight;

    // Total scrollable height
    const totalHeight = totalRows * rowHeight;

    // RAF-based scroll handler for 60fps
    const handleScroll = useCallback((newScrollTop: number) => {
        if (!tickingRef.current) {
            tickingRef.current = true;
            requestAnimationFrame(() => {
                setScrollTop(newScrollTop);
                tickingRef.current = false;
            });
        }
    }, []);

    return {
        startIndex,
        endIndex,
        visibleRows,
        offsetTop,
        totalHeight,
        handleScroll,
    };
}

// =============================================================================
// Debounced Scroll for Fast Scrolling
// =============================================================================

export function useDebouncedCallback<T extends (...args: unknown[]) => void>(
    callback: T,
    delay: number
): T {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const debouncedFn = useCallback(
        (...args: Parameters<T>) => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                callback(...args);
            }, delay);
        },
        [callback, delay]
    ) as T;

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return debouncedFn;
}
