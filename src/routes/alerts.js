import express from 'express';
import authMiddleware from '../middleware/auth.js';
import alertLoopService from '../services/alertLoopService.js';

const router = express.Router();

/**
 * GET /api/v1/alerts/active
 * Get user's active (unacknowledged) alert
 */
router.get('/active', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const alert = await alertLoopService.getActiveAlert(userId);

    if (!alert) {
      return res.json({
        success: true,
        hasActiveAlert: false,
        alert: null
      });
    }

    res.json({
      success: true,
      hasActiveAlert: true,
      alert: {
        id: alert.id,
        sessionId: alert.sessionId,
        reason: alert.reason,
        gameName: alert.gameName,
        startedAt: alert.startedAt,
        notificationsSent: alert.notificationsSent,
        maxNotifications: alert.maxNotifications
      }
    });
  } catch (error) {
    console.error('Error getting active alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get active alert'
    });
  }
});

/**
 * POST /api/v1/alerts/:alertId/acknowledge
 * Acknowledge an alert (stops the notification loop)
 */
router.post('/:alertId/acknowledge', authMiddleware, async (req, res) => {
  try {
    const { alertId } = req.params;
    const userId = req.user.userId;

    const result = await alertLoopService.acknowledgeAlert(alertId, userId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'Alert acknowledged',
      alert: {
        id: result.alert.id,
        acknowledgedAt: result.alert.acknowledgedAt
      }
    });
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge alert'
    });
  }
});

/**
 * GET /api/v1/alerts/history
 * Get user's alert history
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 20;

    const { default: prisma } = await import('../services/database.js');

    const alerts = await prisma.activeAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sessionId: true,
        reason: true,
        gameName: true,
        startedAt: true,
        acknowledged: true,
        acknowledgedAt: true,
        notificationsSent: true
      }
    });

    res.json({
      success: true,
      alerts
    });
  } catch (error) {
    console.error('Error getting alert history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get alert history'
    });
  }
});

export default router;
