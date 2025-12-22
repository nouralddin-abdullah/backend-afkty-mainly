import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/index.js';
import redisService from './services/redis.js';
import fcmService from './services/fcm.js';
import websocketServiceV2 from './services/websocketV2.js';
import sessionService from './services/sessionService.js';
import prisma from './services/database.js';

// Import routes
import hubRoutes from './routes/hubs.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';
import statusRoutes from './routes/status.js';
import sdkRoutes from './routes/sdk.js';
import alertRoutes from './routes/alerts.js';
import alertLoopService from './services/alertLoopService.js';

const app = express();
const server = createServer(app);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (only in development)
if (config.nodeEnv === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Health check
app.get('/health', async (req, res) => {
  const wsStats = websocketServiceV2.getStats();
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: Date.now(),
    connections: wsStats
  });
});

// API Routes
app.use('/api/v1/hubs', hubRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/status', statusRoutes);
app.use('/api/v1/sdk', sdkRoutes);
app.use('/api/v1/alerts', alertRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Initialize services and start server
async function start() {
  try {
    console.log('🚀 Starting Afkty Backend Server v2.0...\n');

    // Connect to Database (PostgreSQL via Prisma)
    await prisma.$connect();
    console.log('✓ Database connected');

    // Cleanup any stale sessions from previous run
    await sessionService.cleanupStaleSessions();

    // Connect to Redis (for caching and real-time data)
    await redisService.connect();

    // Initialize Firebase
    fcmService.initialize();

    // Restore active alert loops (Life or Death Mode)
    await alertLoopService.restoreActiveLoops();

    // Initialize WebSocket server v2
    websocketServiceV2.initialize(server);

    // Start HTTP server
    server.listen(config.port, '0.0.0.0', () => {
      console.log(`\n✓ Server running on port ${config.port}`);
      console.log(`✓ Environment: ${config.nodeEnv}`);
      console.log(`\n📡 WebSocket: ws://localhost:${config.port}/ws`);
      console.log(`📋 API: http://localhost:${config.port}/api/v1`);
      console.log(`💚 Health: http://localhost:${config.port}/health\n`);
      console.log('🔍 Dead Man\'s Switch v2 is active...\n');
      console.log('📌 New Authentication Flow:');
      console.log('   - Hubs: Register at /api/v1/hubs/apply');
      console.log('   - Users: Register at /api/v1/users/register');
      console.log('   - SDK: Connect with hubKey + userToken\n');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    await websocketServiceV2.shutdown();
    await prisma.$disconnect();
    await redisService.disconnect();
    server.close(() => {
      console.log('✓ Server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the server
start();
