// Load environment variables FIRST (before any other imports)
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dataController from './controllers/data.controller';
import { trinoService } from './services/trino.service';
import { queryBuilderService } from './services/query-builder.service';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Compression first for best performance
app.use(compression()); // Gzip compression - reduces response size by 70-80%

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000'], // Vite ports + CRA
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/data', dataController);

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    });
});

// Start server
async function startServer() {
    // Test Trino connection
    console.log('[Server] Testing Trino connection...');
    const connected = await trinoService.testConnection();

    if (!connected) {
        console.error('[Server] ERROR: Could not connect to Trino. Exiting.');
        process.exit(1);
    }

    // Initialize query builder with schema discovery
    console.log('[Server] Discovering table schema...');
    try {
        await queryBuilderService.initialize();
        const metadata = queryBuilderService.getMetadata();
        console.log(`[Server] Schema loaded: ${metadata.dimensions.length} dimensions, ${metadata.metrics.length} metrics`);
    } catch (error) {
        console.error('[Server] ERROR: Failed to initialize query builder:', error);
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log(`[Server] Running on http://localhost:${PORT}`);
        console.log(`[Server] API endpoints:`);
        console.log(`  POST /api/data/query    - Query data`);
        console.log(`  POST /api/data/query-raw - Query data (columnar)`);
        console.log(`  POST /api/data/search   - Search autocomplete`);
        console.log(`  GET  /api/data/metadata - Get column metadata`);
        console.log(`  GET  /api/data/filters/:column - Get filter values`);
        console.log(`  GET  /api/data/cache/stats - Cache statistics`);
        console.log(`  POST /api/data/cache/clear - Clear cache`);
    });
}

startServer();
