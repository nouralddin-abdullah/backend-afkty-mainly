import express from 'express';
import redisService from '../services/redis.js';
import websocketService from '../services/websocket.js';
import deadmanService from '../services/deadman.js';

const router = express.Router();

/**
 * GET /api/v1/status
 * Get server status and statistics
 */
router.get('/', async (req, res) => {
  try {
    const wsStats = websocketService.getStats();
    const redisStats = await redisService.getStats();
    const deadmanStats = deadmanService.getStats();

    res.json({
      success: true,
      status: 'online',
      uptime: process.uptime(),
      timestamp: Date.now(),
      stats: {
        websocket: wsStats,
        redis: redisStats,
        deadman: deadmanStats
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch status'
    });
  }
});

export default router;
