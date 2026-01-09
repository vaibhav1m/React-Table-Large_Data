import { TrinoConfig } from '../types/data.types';

// =============================================================================
// Trino Client Service
// =============================================================================

interface TrinoResponse {
    nextUri?: string;
    columns?: Array<{ name: string; type: string }>;
    data?: unknown[][];
    error?: { message: string };
}

interface QueryResult {
    columns: Array<{ name: string; type: string }>;
    data: Record<string, unknown>[];
}

class TrinoService {
    private config: TrinoConfig;
    private baseUrl: string;

    constructor() {
        this.config = {
            host: process.env.TRINO_HOST || 'localhost',
            port: parseInt(process.env.TRINO_PORT || '8080', 10),
            user: process.env.TRINO_USER || 'analyst',
            catalog: process.env.TRINO_CATALOG || 'hive',
            schema: process.env.TRINO_SCHEMA || 'default',
        };

        this.baseUrl = `http://${this.config.host}:${this.config.port}`;
    }

    /**
     * Execute a SQL query against Trino
     */
    async query(sql: string): Promise<QueryResult> {
        const startTime = Date.now();

        try {
            // Initial query submission
            const response = await fetch(`${this.baseUrl}/v1/statement`, {
                method: 'POST',
                headers: {
                    'X-Trino-User': this.config.user,
                    'X-Trino-Catalog': this.config.catalog,
                    'X-Trino-Schema': this.config.schema,
                    'Content-Type': 'text/plain',
                },
                body: sql,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Trino query submission failed: ${response.status} - ${errorText}`);
            }

            let result: TrinoResponse = await response.json() as TrinoResponse;

            // Poll for results until query completes
            const allData: Record<string, unknown>[] = [];
            let columns: Array<{ name: string; type: string }> = [];

            while (result.nextUri) {
                // Capture columns from first response that has them
                if (result.columns && !columns.length) {
                    columns = result.columns.map((col: { name: string; type: string }) => ({
                        name: col.name,
                        type: col.type,
                    }));
                }

                // Collect data if present
                if (result.data) {
                    const rows = this.transformRows(result.data, columns);
                    allData.push(...rows);
                }

                // Poll next URI
                await this.delay(100); // Small delay to avoid hammering
                const nextResponse = await fetch(result.nextUri, {
                    headers: {
                        'X-Trino-User': this.config.user,
                    },
                });

                if (!nextResponse.ok) {
                    throw new Error(`Trino polling failed: ${nextResponse.status}`);
                }

                result = await nextResponse.json() as TrinoResponse;
            }

            // Capture final batch of data
            if (result.columns && !columns.length) {
                columns = result.columns.map((col: { name: string; type: string }) => ({
                    name: col.name,
                    type: col.type,
                }));
            }

            if (result.data) {
                const rows = this.transformRows(result.data, columns);
                allData.push(...rows);
            }

            // Check for errors
            if (result.error) {
                throw new Error(`Trino query error: ${result.error.message}`);
            }

            const queryTime = Date.now() - startTime;
            console.log(`[Trino] Query completed in ${queryTime}ms, returned ${allData.length} rows`);

            return { columns, data: allData };
        } catch (error) {
            console.error('[Trino] Query failed:', error);
            throw error;
        }
    }

    /**
     * Transform array-based rows to object-based rows
     */
    private transformRows(
        data: unknown[][],
        columns: Array<{ name: string; type: string }>
    ): Record<string, unknown>[] {
        return data.map((row) => {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, index) => {
                obj[col.name] = row[index];
            });
            return obj;
        });
    }

    /**
     * Helper delay function
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Get the full table name with catalog and schema
     */
    getFullTableName(tableName: string): string {
        return `${this.config.catalog}.${this.config.schema}.${tableName}`;
    }

    /**
     * Test connection to Trino
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.query('SELECT 1');
            console.log('[Trino] Connection test successful');
            return true;
        } catch (error) {
            console.error('[Trino] Connection test failed:', error);
            return false;
        }
    }

    /**
     * Get table schema (columns and types) from Trino
     */
    async getTableSchema(tableName: string): Promise<Array<{ name: string; type: string }>> {
        const sql = `DESCRIBE ${tableName}`;
        console.log(`[Trino] Fetching schema for table: ${tableName}`);

        const result = await this.query(sql);

        // DESCRIBE returns rows with column_name and data_type
        const columns = result.data.map((row) => ({
            name: String(row.Column || row.column_name || row['Column']),
            type: String(row.Type || row.data_type || row['Type']).toLowerCase(),
        }));

        console.log(`[Trino] Found ${columns.length} columns in ${tableName}`);
        return columns;
    }

    /**
     * Execute query and return raw columnar format (no object transformation)
     * Much more efficient - avoids O(n*m) object creation
     */
    async queryRaw(sql: string): Promise<{
        columns: string[];
        columnTypes: string[];
        data: (string | number | null)[][];
    }> {
        const startTime = Date.now();

        try {
            // Initial request
            const response = await fetch(`${this.baseUrl}/v1/statement`, {
                method: 'POST',
                headers: {
                    'X-Trino-User': this.config.user,
                    'X-Trino-Catalog': this.config.catalog,
                    'X-Trino-Schema': this.config.schema,
                },
                body: sql,
            });

            if (!response.ok) {
                throw new Error(`Trino request failed: ${response.status} ${response.statusText}`);
            }

            let result = await response.json() as TrinoResponse;

            const columnNames: string[] = [];
            const columnTypes: string[] = [];
            const allData: (string | number | null)[][] = [];

            // Poll until query completes
            while (result.nextUri) {
                // Capture column info
                if (result.columns && !columnNames.length) {
                    result.columns.forEach((col: { name: string; type: string }) => {
                        columnNames.push(col.name);
                        columnTypes.push(col.type);
                    });
                }

                // Collect raw data (no transformation)
                if (result.data) {
                    allData.push(...(result.data as (string | number | null)[][]));
                }

                // Poll next page
                await this.delay(100);
                const nextResponse = await fetch(result.nextUri, {
                    headers: {
                        'X-Trino-User': this.config.user,
                    },
                });

                if (!nextResponse.ok) {
                    throw new Error(`Trino polling failed: ${nextResponse.status}`);
                }

                result = await nextResponse.json() as TrinoResponse;
            }

            // Capture final batch
            if (result.columns && !columnNames.length) {
                result.columns.forEach((col: { name: string; type: string }) => {
                    columnNames.push(col.name);
                    columnTypes.push(col.type);
                });
            }

            if (result.data) {
                allData.push(...(result.data as (string | number | null)[][]));
            }

            if (result.error) {
                throw new Error(`Trino query error: ${result.error.message}`);
            }

            const queryTime = Date.now() - startTime;
            console.log(`[Trino] Raw query completed in ${queryTime}ms, returned ${allData.length} rows`);

            return { columns: columnNames, columnTypes, data: allData };
        } catch (error) {
            console.error('[Trino] Raw query failed:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const trinoService = new TrinoService();
