import axios from 'axios';
import type { QueryRequest, QueryResponse, ColumnarQueryResponse, TableMetadata } from '../types/data.types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// AbortController for request deduplication
let currentQueryController: AbortController | null = null;

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
     * Automatically cancels previous pending requests (deduplication)
     */
    async queryRaw(request: QueryRequest): Promise<ColumnarQueryResponse> {
        // Cancel previous request if pending
        if (currentQueryController) {
            currentQueryController.abort();
        }
        currentQueryController = new AbortController();

        try {
            const response = await api.post<ColumnarQueryResponse>(
                '/api/data/query-raw',
                request,
                { signal: currentQueryController.signal }
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
};

