import axios from 'axios';
import type { QueryRequest, QueryResponse, ColumnarQueryResponse, TableMetadata } from '../types/data.types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Separate AbortControllers for different request types
// This prevents prefetch from being cancelled when initial fetch is made
let initialQueryController: AbortController | null = null;
let prefetchController: AbortController | null = null;
let searchController: AbortController | null = null;

// =============================================================================
// Data API Service
// =============================================================================

export const dataService = {
    /**
     * Query data (legacy object format)
     */
    async query(request: QueryRequest): Promise<QueryResponse> {
        const response = await api.post<QueryResponse>('/api/data/query', request);
        return response.data;
    },

    /**
     * Query data with optimized columnar format
     * Cancels previous initial queries (not prefetch) to prevent stale data
     */
    async queryRaw(request: QueryRequest, isPrefetch: boolean = false): Promise<ColumnarQueryResponse> {
        // Use different controller based on request type
        if (isPrefetch) {
            // Cancel previous prefetch if any
            if (prefetchController) {
                prefetchController.abort();
            }
            prefetchController = new AbortController();

            try {
                const response = await api.post<ColumnarQueryResponse>(
                    '/api/data/query-raw',
                    request,
                    { signal: prefetchController.signal }
                );
                return response.data;
            } catch (error) {
                if (axios.isCancel(error)) {
                    throw new Error('Request cancelled');
                }
                throw error;
            }
        } else {
            // Initial/regular query - cancel previous initial query
            if (initialQueryController) {
                initialQueryController.abort();
            }
            initialQueryController = new AbortController();

            try {
                const response = await api.post<ColumnarQueryResponse>(
                    '/api/data/query-raw',
                    request,
                    { signal: initialQueryController.signal }
                );
                return response.data;
            } catch (error) {
                if (axios.isCancel(error)) {
                    throw new Error('Request cancelled');
                }
                throw error;
            }
        }
    },

    /**
     * Fetch ALL data from backend for DuckDB initialization
     * This loads all rows in one request (no pagination)
     */
    async fetchAllData(dimensions: string[], metrics: string[]): Promise<ColumnarQueryResponse> {
        // Cancel any existing requests
        if (initialQueryController) {
            initialQueryController.abort();
        }
        initialQueryController = new AbortController();

        try {
            const request: QueryRequest = {
                dimensions,
                metrics,
                filters: [],
                sort: [],
                offset: 0,
                limit: 100000, // Load all rows
            };

            const response = await api.post<ColumnarQueryResponse>(
                '/api/data/query-raw',
                request,
                { signal: initialQueryController.signal }
            );
            return response.data;
        } catch (error) {
            if (axios.isCancel(error)) {
                throw new Error('Request cancelled');
            }
            throw error;
        }
    },

    /**
     * Get table metadata (available columns)
     */
    async getMetadata(): Promise<TableMetadata> {
        const response = await api.get<TableMetadata>('/api/data/metadata');
        return response.data;
    },

    /**
     * Get distinct values for a filter column
     */
    async getFilterValues(column: string): Promise<{ column: string; values: string[] }> {
        const response = await api.get<{ column: string; values: string[] }>(
            `/api/data/filters/${column}`
        );
        return response.data;
    },

    /**
     * Clear server cache
     */
    async clearCache(): Promise<void> {
        await api.post('/api/data/cache/clear');
    },

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{ size: number; maxSize: number; ttlSeconds: number }> {
        const response = await api.get<{ size: number; maxSize: number; ttlSeconds: number }>(
            '/api/data/cache/stats'
        );
        return response.data;
    },

    /**
     * Search for autocomplete results
     * Cancels any previous search request to avoid stale results
     */
    async search(query: string, columns?: string[]): Promise<{
        results: Array<{ column: string; value: string; label: string }>;
        groupedResults: Record<string, string[]>;
        queryTimeMs: number;
    }> {
        // Cancel any existing search request
        if (searchController) {
            searchController.abort();
        }
        searchController = new AbortController();

        const response = await api.post<{
            results: Array<{ column: string; value: string; label: string }>;
            groupedResults: Record<string, string[]>;
            queryTimeMs: number;
        }>('/api/data/search', { query, columns, limit: 50 }, {
            signal: searchController.signal
        });
        return response.data;
    },
};
