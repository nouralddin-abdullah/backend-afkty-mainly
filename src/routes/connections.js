import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import redisService from '../services/redis.js';
import fcmService from '../services/fcm.js';

const router = express.Router();

/**
 * Generate a random connection key
 */
function generateConnectionKey() {
  const prefix = 'afk';
  const part1 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const part2 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${part1}-${part2}`;
}

/**
 * POST /api/v1/connections/generate
 * Generate a new connection key for linking Roblox script
 */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { expiryMinutes = 5 } = req.body;

    // Generate unique key
    let key;
    let attempts = 0;
    
    do {
      key = generateConnectionKey();
      attempts++;
      
      if (attempts > 10) {
        throw new Error('Failed to generate unique key');
      }
    } while (await redisService.getConnectionKey(key));

    // Store key in Redis with expiry
    const expirySeconds = expiryMinutes * 60;
    await redisService.setConnectionKey(key, userId, expirySeconds);

    res.json({
      success: true,
      connectionKey: key,
      expiresIn: expirySeconds,
      expiresAt: Date.now() + (expirySeconds * 1000)
    });
  } catch (error) {
    console.error('Key generation error:', error);
    res.status(500).json({
      error: 'Failed to generate connection key'
    });
  }
});

/**
 * GET /api/v1/connections/active
 * Get all active Roblox sessions for the authenticated user
 */
router.get('/active', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessions = await redisService.getUserSessions(userId);

    res.json({
      success: true,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        gameInfo: s.gameInfo,
        connectedAt: parseInt(s.connectedAt),
        lastHeartbeat: parseInt(s.lastHeartbeat),
        status: s.status
      }))
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      error: 'Failed to fetch active sessions'
    });
  }
});

/**
 * DELETE /api/v1/connections/:sessionId
 * Manually disconnect a session
 */
router.delete('/:sessionId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    // Verify session belongs to user
    const connection = await redisService.getActiveConnection(sessionId);
    
    if (!connection) {
      return res.status(404).json({
        error: 'Session not found'
      });
    }

    if (connection.userId !== userId) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    // Delete session
    await redisService.deleteActiveConnection(sessionId);

    res.json({
      success: true,
      message: 'Session disconnected'
    });
  } catch (error) {
    console.error('Error disconnecting session:', error);
    res.status(500).json({
      error: 'Failed to disconnect session'
    });
  }
});

/**
 * POST /api/v1/connections/test-notification
 * Send a test notification to the user
 */
router.post('/test-notification', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user's FCM token
    const userDevice = await redisService.getUserDevice(userId);
    
    if (!userDevice || !userDevice.fcmToken) {
      return res.status(404).json({
        error: 'No device registered. Please connect your mobile app first.'
      });
    }

    // Send test notification (regular notification, not critical alert)
    const { title = '✨ Afkty', message = 'Hello from Backend! 👋' } = req.body;
    
    const result = await fcmService.sendNotification(userDevice.fcmToken, {
      title: title,
      body: message,
      data: {
        userId: userId,
        testNotification: 'true'
      }
    });

    if (result.success) {
      res.json({
        success: true,
        message: 'Test notification sent!',
        messageId: result.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.reason
      });
    }
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({
      error: 'Failed to send test notification'
    });
  }
});

export default router;
