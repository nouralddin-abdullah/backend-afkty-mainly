import prisma from './database.js';
import fcmService from './fcm.js';

/**
 * Device Service
 * Manages user devices and FCM tokens for push notifications
 */

class DeviceService {
  /**
   * Register or update a device for a user
   * Handles FCM token refresh automatically
   */
  async registerDevice(userId, { fcmToken, name, platform, appVersion }) {
    // Check if this FCM token exists for another user
    const existingDevice = await prisma.device.findUnique({
      where: { fcmToken }
    });

    if (existingDevice) {
      if (existingDevice.userId === userId) {
        // Same user, update the device
        return prisma.device.update({
          where: { id: existingDevice.id },
          data: {
            name,
            platform,
            appVersion,
            isActive: true,
            lastSeenAt: new Date(),
            tokenUpdatedAt: new Date(),
            failedAttempts: 0,
            lastFailReason: null
          }
        });
      } else {
        // Different user - transfer device ownership
        // This handles the case where user logs out and another logs in
        return prisma.device.update({
          where: { id: existingDevice.id },
          data: {
            userId,
            name,
            platform,
            appVersion,
            isActive: true,
            lastSeenAt: new Date(),
            tokenUpdatedAt: new Date(),
            failedAttempts: 0,
            lastFailReason: null
          }
        });
      }
    }

    // New device
    return prisma.device.create({
      data: {
        userId,
        fcmToken,
        name,
        platform,
        appVersion
      }
    });
  }

  /**
   * Update FCM token for a device (token refresh)
   */
  async updateFcmToken(oldToken, newToken) {
    const device = await prisma.device.findUnique({
      where: { fcmToken: oldToken }
    });

    if (!device) {
      return null;
    }

    return prisma.device.update({
      where: { id: device.id },
      data: {
        fcmToken: newToken,
        tokenUpdatedAt: new Date(),
        failedAttempts: 0,
        lastFailReason: null
      }
    });
  }

  /**
   * Get user's active devices
   */
  async getUserDevices(userId) {
    return prisma.device.findMany({
      where: {
        userId,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        platform: true,
        appVersion: true,
        lastSeenAt: true,
        createdAt: true
      },
      orderBy: { lastSeenAt: 'desc' }
    });
  }

  /**
   * Get all active FCM tokens for a user
   */
  async getUserFcmTokens(userId) {
    const devices = await prisma.device.findMany({
      where: {
        userId,
        isActive: true
      },
      select: {
        id: true,
        fcmToken: true
      }
    });

    return devices;
  }

  /**
   * Remove a device (hard delete)
   */
  async removeDevice(userId, deviceId) {
    const device = await prisma.device.findFirst({
      where: {
        id: deviceId,
        userId
      }
    });

    if (!device) {
      return null;
    }

    // Hard delete - completely remove the device
    await prisma.device.delete({
      where: { id: deviceId }
    });
    
    return device;
  }

  /**
   * Mark device FCM token as invalid
   * Called when push notification fails
   */
  async markTokenInvalid(fcmToken, reason) {
    const device = await prisma.device.findUnique({
      where: { fcmToken }
    });

    if (!device) {
      return null;
    }

    const newFailedAttempts = device.failedAttempts + 1;

    // If too many failures, deactivate the device
    if (newFailedAttempts >= 3) {
      return prisma.device.update({
        where: { id: device.id },
        data: {
          isActive: false,
          failedAttempts: newFailedAttempts,
          lastFailReason: reason
        }
      });
    }

    return prisma.device.update({
      where: { id: device.id },
      data: {
        failedAttempts: newFailedAttempts,
        lastFailReason: reason
      }
    });
  }

  /**
   * Update device last seen time
   */
  async updateLastSeen(fcmToken) {
    return prisma.device.update({
      where: { fcmToken },
      data: { lastSeenAt: new Date() }
    });
  }

  /**
   * Send push notification to all user's devices
   * Handles failures and token cleanup
   */
  async sendPushToUser(userId, notification) {
    const devices = await this.getUserFcmTokens(userId);

    if (devices.length === 0) {
      return { success: false, reason: 'NO_DEVICES' };
    }

    const results = await Promise.all(
      devices.map(async (device) => {
        try {
          const result = await fcmService.sendNotification(device.fcmToken, notification);
          
          if (result.success) {
            // Reset fail counter on success
            await prisma.device.update({
              where: { id: device.id },
              data: { failedAttempts: 0, lastFailReason: null }
            });
            return { deviceId: device.id, success: true };
          } else {
            // Handle failure
            await this.markTokenInvalid(device.fcmToken, result.error);
            return { deviceId: device.id, success: false, error: result.error };
          }
        } catch (error) {
          await this.markTokenInvalid(device.fcmToken, error.message);
          return { deviceId: device.id, success: false, error: error.message };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    
    return {
      success: successCount > 0,
      totalDevices: devices.length,
      successCount,
      results
    };
  }

  /**
   * Send critical alert to all user's devices
   */
  async sendCriticalAlertToUser(userId, alertData) {
    const devices = await this.getUserFcmTokens(userId);

    if (devices.length === 0) {
      console.log(`📱 No devices registered for user ${userId}`);
      return { success: false, reason: 'NO_DEVICES' };
    }

    const results = await Promise.all(
      devices.map(async (device) => {
        try {
          const result = await fcmService.sendCriticalAlert(device.fcmToken, alertData);
          
          if (result.success) {
            await prisma.device.update({
              where: { id: device.id },
              data: { failedAttempts: 0, lastFailReason: null }
            });
            return { deviceId: device.id, success: true };
          } else {
            await this.markTokenInvalid(device.fcmToken, result.reason);
            return { deviceId: device.id, success: false, error: result.reason };
          }
        } catch (error) {
          await this.markTokenInvalid(device.fcmToken, error.message);
          return { deviceId: device.id, success: false, error: error.message };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    console.log(`🔔 Alert sent to ${successCount}/${devices.length} devices for user ${userId}`);
    
    return {
      success: successCount > 0,
      totalDevices: devices.length,
      successCount,
      results
    };
  }

  /**
   * Cleanup inactive devices older than X days
   */
  async cleanupInactiveDevices(daysOld = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await prisma.device.deleteMany({
      where: {
        isActive: false,
        updatedAt: { lt: cutoff }
      }
    });

    return result.count;
  }
}

export default new DeviceService();
