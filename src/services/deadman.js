import config from '../config/index.js';
import redisService from './redis.js';
import fcmService from './fcm.js';

class DeadMansSwitchService {
  constructor() {
    this.monitoredSessions = new Map(); // sessionId -> { timer, sessionData }
  }

  /**
   * Start monitoring a session for heartbeats
   */
  startMonitoring(sessionId, sessionData) {
    if (config.nodeEnv === 'development') {
      console.log(`🔍 Monitoring session: ${sessionId}`);
    }
    
    // Clear any existing timer
    this.stopMonitoring(sessionId);

    // Create new monitoring timer
    const timer = setTimeout(() => {
      this.handleTimeout(sessionId, sessionData);
    }, config.deadman.heartbeatTimeout);

    this.monitoredSessions.set(sessionId, {
      timer,
      sessionData,
      lastUpdate: Date.now()
    });
  }

  /**
   * Reset the timer when a heartbeat is received
   */
  resetTimer(sessionId) {
    const monitored = this.monitoredSessions.get(sessionId);
    if (!monitored) {
      console.warn(`Session ${sessionId} not being monitored`);
      return false;
    }

    // Clear old timer
    clearTimeout(monitored.timer);

    // Start new timer
    const timer = setTimeout(() => {
      this.handleTimeout(sessionId, monitored.sessionData);
    }, config.deadman.heartbeatTimeout);

    monitored.timer = timer;
    monitored.lastUpdate = Date.now();
    this.monitoredSessions.set(sessionId, monitored);

    // Update Redis
    redisService.updateHeartbeat(sessionId);

    return true;
  }

  /**
   * Stop monitoring a session (clean disconnect)
   */
  stopMonitoring(sessionId) {
    const monitored = this.monitoredSessions.get(sessionId);
    if (monitored) {
      clearTimeout(monitored.timer);
      this.monitoredSessions.delete(sessionId);
      
      if (config.nodeEnv === 'development') {
        console.log(`✓ Stopped monitoring: ${sessionId}`);
      }
    }
  }

  /**
   * Handle timeout - the Dead Man's Switch has triggered
   */
  async handleTimeout(sessionId, sessionData) {
    console.log(`⚠ TIMEOUT DETECTED for session: ${sessionId}`);
    
    this.monitoredSessions.delete(sessionId);

    try {
      // Get the active connection details from Redis
      const connection = await redisService.getActiveConnection(sessionId);
      
      if (!connection) {
        console.warn(`No active connection found for ${sessionId}`);
        return;
      }

      const userId = connection.userId;
      
      // Check if user has a mobile device registered
      const userDevice = await redisService.getUserDevice(userId);
      
      if (!userDevice || !userDevice.fcmToken) {
        console.log(`📱 No mobile device registered for user ${userId}. Alert would be sent here.`);
        await this.logDisconnect(sessionId, 'timeout', 'No device registered');
        return;
      }

      // Fire the Critical Alert
      console.log(`🚨 TRIGGERING CRITICAL ALERT for user ${userId}`);
      
      const alertData = {
        sessionId,
        reason: 'Heartbeat timeout - possible crash or disconnect',
        gameName: connection.gameInfo?.name || 'Unknown Game',
        userId
      };

      const result = await fcmService.sendCriticalAlert(userDevice.fcmToken, alertData);
      
      if (result.success) {
        console.log(`✓ Critical alert delivered to ${userId}`);
      } else {
        console.log(`⚠ Could not send alert: ${result.reason} (This is normal without mobile app)`);
      }

      // Clean up the connection
      await redisService.deleteActiveConnection(sessionId);
      await this.logDisconnect(sessionId, 'timeout', 'Dead Man Switch triggered');

    } catch (error) {
      console.error(`Error handling timeout for ${sessionId}:`, error);
    }
  }

  async handleExplicitDisconnect(sessionId, reason = 'Manual disconnect') {
    console.log(`📴 Explicit disconnect: ${sessionId} - ${reason}`);
    
    this.stopMonitoring(sessionId);

    try {
      const connection = await redisService.getActiveConnection(sessionId);
      
      if (connection) {
        const userId = connection.userId;
        const userDevice = await redisService.getUserDevice(userId);
        
        console.log(`📱 User ${userId} device:`, userDevice ? 'Found' : 'Not found');
        
        // Still send alert, but with different reason
        if (userDevice && userDevice.fcmToken) {
          const alertData = {
            sessionId,
            reason,
            gameName: connection.gameInfo?.name || 'Unknown Game',
            userId
          };

          console.log(`🔔 Sending FCM critical alert for disconnect...`);
          const result = await fcmService.sendCriticalAlert(userDevice.fcmToken, alertData);
          if (result.success) {
            console.log(`✓ Disconnect alert sent via FCM`);
          } else {
            console.log(`⚠ FCM alert failed: ${result.reason}`);
          }
        } else {
          console.log(`📱 No FCM token for user ${userId}. WebSocket alert only.`);
        }

        await redisService.deleteActiveConnection(sessionId);
      } else {
        console.log(`⚠ No connection found for session ${sessionId}`);
      }

      await this.logDisconnect(sessionId, 'explicit', reason);
    } catch (error) {
      console.error(`Error handling explicit disconnect for ${sessionId}:`, error);
    }
  }

  /**
   * Handle abrupt disconnection (with grace period for reconnection)
   */
  async handleAbruptDisconnect(sessionId) {
    if (config.nodeEnv === 'development') {
      console.log(`💔 Abrupt disconnect: ${sessionId}`);
      console.log(`⏳ Grace period of ${config.deadman.reconnectGracePeriod}ms for reconnection...`);
    }
    
    // Give a grace period for reconnection
    setTimeout(async () => {
      // Check if session reconnected during grace period
      if (this.monitoredSessions.has(sessionId)) {
        if (config.nodeEnv === 'development') {
          console.log(`✓ Session ${sessionId} reconnected during grace period`);
        }
        return;
      }

      // If not reconnected, treat as timeout
      console.log(`⚠ Session ${sessionId} did not reconnect. Triggering alert.`);
      
      const connection = await redisService.getActiveConnection(sessionId);
      if (connection) {
        await this.handleTimeout(sessionId, connection);
      }
    }, config.deadman.reconnectGracePeriod);
  }

  /**
   * Log disconnect event
   */
  async logDisconnect(sessionId, type, reason) {
    const logEntry = {
      sessionId,
      type,
      reason,
      timestamp: Date.now()
    };
    
    // Store in Redis with expiry (for recent disconnects view)
    await redisService.client.lPush('disconnect_log', JSON.stringify(logEntry));
    await redisService.client.lTrim('disconnect_log', 0, 99); // Keep last 100
    
    if (config.nodeEnv === 'development') {
      console.log('📝 Disconnect logged:', logEntry);
    }
  }

  /**
   * Get monitoring stats
   */
  getStats() {
    return {
      monitoredSessions: this.monitoredSessions.size,
      sessions: Array.from(this.monitoredSessions.keys())
    };
  }
}

export default new DeadMansSwitchService();
