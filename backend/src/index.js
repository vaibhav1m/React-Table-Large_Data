// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dataController = require('./controllers/data.controller');
const { trinoService } = require('./services/trino.service');
const { queryBuilderService } = require('./services/query-builder.service');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(compression());
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000'],
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
});

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/data', dataController);

// Error handling
app.use((err, _req, res, _next) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    });
});

// Start server
async function startServer() {
    console.log('[Server] Testing Trino connection...');
    const connected = await trinoService.testConnection();

    if (!connected) {
        console.error('[Server] ERROR: Could not connect to Trino. Exiting.');
        process.exit(1);
    }

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
