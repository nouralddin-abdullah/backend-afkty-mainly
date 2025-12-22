import prisma from './database.js';
import fcmService from './fcm.js';
import deviceService from './deviceService.js';

/**
 * Alert Loop Service
 * Handles "Life or Death Mode" - sends repeated notifications until acknowledged
 */

class AlertLoopService {
  constructor() {
    this.activeLoops = new Map(); // alertId -> intervalId
    this.NOTIFICATION_INTERVAL = 10000; // 10 seconds
    this.MAX_NOTIFICATIONS = 30; // 5 minutes max
  }

  /**
   * Start a new alert loop for a user
   */
  async startAlertLoop(userId, sessionId, reason, gameName) {
    // Check if user has Life or Death mode enabled
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lifeOrDeathMode: true }
    });

    if (!user?.lifeOrDeathMode) {
      console.log(`[AlertLoop] User ${userId} does not have Life or Death mode enabled`);
      return null;
    }

    // Check if there's already an active alert for this user
    const existingAlert = await prisma.activeAlert.findFirst({
      where: {
        userId,
        acknowledged: false
      }
    });

    if (existingAlert) {
      console.log(`[AlertLoop] User ${userId} already has an active alert: ${existingAlert.id}`);
      return existingAlert;
    }

    // Create new active alert
    const alert = await prisma.activeAlert.create({
      data: {
        userId,
        sessionId,
        reason,
        gameName,
        notificationsSent: 1 // First notification sent by normal alert
      }
    });

    console.log(`[AlertLoop] Started alert loop for user ${userId}, alert ${alert.id}`);

    // Start the notification loop
    this.startLoop(alert.id, userId);

    return alert;
  }

  /**
   * Start the actual notification loop
   */
  startLoop(alertId, userId) {
    // Clear any existing loop for this alert
    if (this.activeLoops.has(alertId)) {
      clearInterval(this.activeLoops.get(alertId));
    }

    const intervalId = setInterval(async () => {
      await this.sendLoopNotification(alertId, userId);
    }, this.NOTIFICATION_INTERVAL);

    this.activeLoops.set(alertId, intervalId);
  }

  /**
   * Send a single loop notification
   */
  async sendLoopNotification(alertId, userId) {
    try {
      // Get current alert state
      const alert = await prisma.activeAlert.findUnique({
        where: { id: alertId }
      });

      if (!alert || alert.acknowledged) {
        console.log(`[AlertLoop] Alert ${alertId} no longer active, stopping loop`);
        this.stopLoop(alertId);
        return;
      }

      // Check if max notifications reached
      if (alert.notificationsSent >= alert.maxNotifications) {
        console.log(`[AlertLoop] Alert ${alertId} reached max notifications, stopping`);
        this.stopLoop(alertId);
        return;
      }

      // Get user's WEB devices only (Android gets single notification)
      const devices = await deviceService.getUserDevices(userId);
      const webDevices = devices.filter(d => d.platform === 'web');

      if (webDevices.length === 0) {
        console.log(`[AlertLoop] No web devices for user ${userId}`);
        return;
      }

      // Update notification count
      await prisma.activeAlert.update({
        where: { id: alertId },
        data: {
          notificationsSent: alert.notificationsSent + 1
        }
      });

      // Send notifications to all web devices
      const notifNumber = alert.notificationsSent + 1;
      for (const device of webDevices) {
        await fcmService.sendCriticalAlert(device.fcmToken, {
          sessionId: alert.sessionId,
          reason: `🚨 ALERT ${notifNumber}/${alert.maxNotifications}: ${alert.reason}`,
          gameName: alert.gameName
        });
      }

      console.log(`[AlertLoop] Sent notification ${notifNumber}/${alert.maxNotifications} for alert ${alertId}`);

    } catch (error) {
      console.error(`[AlertLoop] Error sending notification for alert ${alertId}:`, error);
    }
  }

  /**
   * Stop an alert loop
   */
  stopLoop(alertId) {
    if (this.activeLoops.has(alertId)) {
      clearInterval(this.activeLoops.get(alertId));
      this.activeLoops.delete(alertId);
      console.log(`[AlertLoop] Stopped loop for alert ${alertId}`);
    }
  }

  /**
   * Acknowledge an alert - stops the loop
   */
  async acknowledgeAlert(alertId, userId) {
    // Verify alert belongs to user
    const alert = await prisma.activeAlert.findFirst({
      where: {
        id: alertId,
        userId,
        acknowledged: false
      }
    });

    if (!alert) {
      return { success: false, error: 'Alert not found or already acknowledged' };
    }

    // Update alert as acknowledged
    await prisma.activeAlert.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date()
      }
    });

    // Stop the loop
    this.stopLoop(alertId);

    console.log(`[AlertLoop] Alert ${alertId} acknowledged by user ${userId}`);

    return { success: true, alert };
  }

  /**
   * Get active alert for a user
   */
  async getActiveAlert(userId) {
    return prisma.activeAlert.findFirst({
      where: {
        userId,
        acknowledged: false
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  /**
   * Restore active loops on server restart
   */
  async restoreActiveLoops() {
    try {
      const activeAlerts = await prisma.activeAlert.findMany({
        where: {
          acknowledged: false,
          notificationsSent: { lt: prisma.raw('maxNotifications') }
        }
      });

      for (const alert of activeAlerts) {
        // Only restore if alert is less than 10 minutes old
        const ageMs = Date.now() - new Date(alert.startedAt).getTime();
        if (ageMs < 10 * 60 * 1000) {
          console.log(`[AlertLoop] Restoring loop for alert ${alert.id}`);
          this.startLoop(alert.id, alert.userId);
        } else {
          // Mark old alerts as acknowledged
          await prisma.activeAlert.update({
            where: { id: alert.id },
            data: { acknowledged: true }
          });
        }
      }

      console.log(`[AlertLoop] Restored ${activeAlerts.length} active loops`);
    } catch (error) {
      console.error('[AlertLoop] Error restoring active loops:', error);
    }
  }
}

export default new AlertLoopService();
