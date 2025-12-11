import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/index.js';
import redisService from './services/redis.js';
import fcmService from './services/fcm.js';
import websocketService from './services/websocket.js';

// Import routes
import authRoutes from './routes/auth.js';
import connectionRoutes from './routes/connections.js';
import statusRoutes from './routes/status.js';
import sdkRoutes from './routes/sdk.js';

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
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now()
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/connections', connectionRoutes);
app.use('/api/v1/status', statusRoutes);
app.use('/api/v1/sdk', sdkRoutes);

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
    console.log('🚀 Starting Afkty Backend Server...\n');

    // Connect to Redis
    await redisService.connect();

    // Initialize Firebase
    fcmService.initialize();

    // Initialize WebSocket server
    websocketService.initialize(server);

    // Start HTTP server (listen on all interfaces for local network access)
    server.listen(config.port, '0.0.0.0', () => {
      console.log(`\n✓ Server running on port ${config.port}`);
      console.log(`✓ Environment: ${config.nodeEnv}`);
      console.log(`\n📡 Local:   ws://localhost:${config.port}/ws`);
      console.log(`📡 Network: ws://YOUR_LOCAL_IP:${config.port}/ws`);
      console.log(`📋 API Docs: http://localhost:${config.port}/api/v1/sdk/docs`);
      console.log(`💚 Health: http://localhost:${config.port}/health\n`);
      console.log('🔍 Dead Man\'s Switch is active and monitoring...\n');
      console.log('⚠️  To find your local IP:');
      console.log('   Windows: ipconfig (look for IPv4 Address)');
      console.log('   Mac/Linux: ifconfig (look for inet)\n');
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
