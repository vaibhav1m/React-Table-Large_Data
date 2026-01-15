// Trino Client Service

class TrinoService {
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

    async query(sql) {
        const startTime = Date.now();

        try {
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

            let result = await response.json();

            const allData = [];
            let columns = [];

            // Adaptive polling: start fast, back off when waiting for data
            let pollDelay = 10;

            while (result.nextUri) {
                if (result.columns && !columns.length) {
                    columns = result.columns.map(col => ({
                        name: col.name,
                        type: col.type,
                    }));
                }

                if (result.data) {
                    const rows = this.transformRows(result.data, columns);
                    allData.push(...rows);
                    pollDelay = 10; // Reset to fast when data arrives
                } else {
                    pollDelay = Math.min(pollDelay * 1.5, 100); // Backoff when no data
                }

                await this.delay(pollDelay);
                const nextResponse = await fetch(result.nextUri, {
                    headers: { 'X-Trino-User': this.config.user },
                });

                if (!nextResponse.ok) {
                    throw new Error(`Trino polling failed: ${nextResponse.status}`);
                }

                result = await nextResponse.json();
            }

            if (result.columns && !columns.length) {
                columns = result.columns.map(col => ({
                    name: col.name,
                    type: col.type,
                }));
            }

            if (result.data) {
                const rows = this.transformRows(result.data, columns);
                allData.push(...rows);
            }

            if (result.error) {
                throw new Error(`Trino query error: ${result.error.message}`);
            }

            console.log(`[Trino] Query completed in ${Date.now() - startTime}ms, returned ${allData.length} rows`);

            return { columns, data: allData };
        } catch (error) {
            console.error('[Trino] Query failed:', error);
            throw error;
        }
    }

    transformRows(data, columns) {
        return data.map((row) => {
            const obj = {};
            columns.forEach((col, index) => {
                obj[col.name] = row[index];
            });
            return obj;
        });
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getFullTableName(tableName) {
        return `${this.config.catalog}.${this.config.schema}.${tableName}`;
    }

    async testConnection() {
        try {
            await this.query('SELECT 1');
            console.log('[Trino] Connection test successful');
            return true;
        } catch (error) {
            console.error('[Trino] Connection test failed:', error);
            return false;
        }
    }

    async getTableSchema(tableName) {
        const sql = `DESCRIBE ${tableName}`;
        console.log(`[Trino] Fetching schema for table: ${tableName}`);

        const result = await this.query(sql);

        const columns = result.data.map((row) => ({
            name: String(row.Column || row.column_name || row['Column']),
            type: String(row.Type || row.data_type || row['Type']).toLowerCase(),
        }));

        console.log(`[Trino] Found ${columns.length} columns in ${tableName}`);
        return columns;
    }

    async queryRaw(sql) {
        const startTime = Date.now();

        try {
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

            let result = await response.json();

            const columnNames = [];
            const columnTypes = [];
            const allData = [];

            // Adaptive polling: start fast, back off when waiting for data
            let pollDelay = 10;

            while (result.nextUri) {
                if (result.columns && !columnNames.length) {
                    result.columns.forEach(col => {
                        columnNames.push(col.name);
                        columnTypes.push(col.type);
                    });
                }

                if (result.data) {
                    allData.push(...result.data);
                    pollDelay = 10; // Reset to fast when data arrives
                } else {
                    pollDelay = Math.min(pollDelay * 1.5, 100); // Backoff when no data
                }

                await this.delay(pollDelay);
                const nextResponse = await fetch(result.nextUri, {
                    headers: { 'X-Trino-User': this.config.user },
                });

                if (!nextResponse.ok) {
                    throw new Error(`Trino polling failed: ${nextResponse.status}`);
                }

                result = await nextResponse.json();
            }

            if (result.columns && !columnNames.length) {
                result.columns.forEach(col => {
                    columnNames.push(col.name);
                    columnTypes.push(col.type);
                });
            }

            if (result.data) {
                allData.push(...result.data);
            }

            if (result.error) {
                throw new Error(`Trino query error: ${result.error.message}`);
            }

            console.log(`[Trino] Raw query completed in ${Date.now() - startTime}ms, returned ${allData.length} rows`);

            return { columns: columnNames, columnTypes, data: allData };
        } catch (error) {
            console.error('[Trino] Raw query failed:', error);
            throw error;
        }
    }
}

const trinoService = new TrinoService();
module.exports = { trinoService };
