import prisma from './database.js';
import deviceService from './deviceService.js';
import logService from './logService.js';
import alertLoopService from './alertLoopService.js';

/**
 * Session Service
 * Manages connection sessions and the Dead Man's Switch
 */

class SessionService {
  /**
   * Create a new session when SDK connects
   */
  async createSession({ userId, hubId, wsClientId, gameInfo }) {
    // Check for existing active session with same wsClientId
    const existing = await prisma.session.findUnique({
      where: { wsClientId }
    });

    if (existing) {
      // Update existing session
      return prisma.session.update({
        where: { id: existing.id },
        data: {
          userId,
          hubId,
          gameName: gameInfo?.name,
          gamePlaceId: gameInfo?.placeId?.toString(),
          gameJobId: gameInfo?.jobId,
          executor: gameInfo?.executor,
          status: 'ACTIVE',
          connectedAt: new Date(),
          lastHeartbeatAt: new Date(),
          disconnectedAt: null,
          disconnectReason: null,
          disconnectMessage: null,
          alertSent: false
        }
      });
    }

    // Create new session
    return prisma.session.create({
      data: {
        userId,
        hubId,
        wsClientId,
        gameName: gameInfo?.name,
        gamePlaceId: gameInfo?.placeId?.toString(),
        gameJobId: gameInfo?.jobId,
        executor: gameInfo?.executor,
        status: 'ACTIVE',
        connectedAt: new Date(),
        lastHeartbeatAt: new Date()
      }
    });
  }

  /**
   * Get session by WebSocket client ID
   */
  async getSessionByWsClientId(wsClientId) {
    return prisma.session.findUnique({
      where: { wsClientId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            alertSound: true,
            quietHoursEnabled: true,
            quietHoursStart: true,
            quietHoursEnd: true
          }
        },
        hub: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
  }

  /**
   * Get session by ID
   */
  async getSessionById(sessionId) {
    return prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
        hub: {
          select: { name: true }
        }
      }
    });
  }

  /**
   * Update heartbeat timestamp
   */
  async updateHeartbeat(wsClientId) {
    return prisma.session.update({
      where: { wsClientId },
      data: { lastHeartbeatAt: new Date() }
    });
  }

  /**
   * Update session status (live status text)
   */
  async updateStatus(wsClientId, statusText) {
    return prisma.session.update({
      where: { wsClientId },
      data: { currentStatus: statusText }
    });
  }

  /**
   * Mark session as disconnected (clean disconnect)
   */
  async disconnectSession(wsClientId, reason = 'MANUAL', message = null) {
    const session = await prisma.session.findUnique({
      where: { wsClientId }
    });

    if (!session) return null;

    return prisma.session.update({
      where: { wsClientId },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        disconnectReason: reason,
        disconnectMessage: message
      }
    });
  }

  /**
   * Mark session as disconnected by session ID (for user-initiated stops)
   */
  async disconnectSessionById(sessionId, reason = 'MANUAL', message = null) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId }
    });

    if (!session) return null;

    return prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        disconnectReason: reason,
        disconnectMessage: message
      }
    });
  }

  /**
   * Handle timeout (Dead Man's Switch triggered)
   * This is the critical alert path
   */
  async handleTimeout(wsClientId) {
    const session = await prisma.session.findUnique({
      where: { wsClientId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            alertSound: true,
            quietHoursEnabled: true,
            quietHoursStart: true,
            quietHoursEnd: true,
            lifeOrDeathMode: true
          }
        },
        hub: {
          select: { name: true }
        }
      }
    });

    if (!session) {
      console.warn(`Session not found for wsClientId: ${wsClientId}`);
      return null;
    }

    // Check quiet hours
    if (session.user.quietHoursEnabled && this.isQuietHours(session.user)) {
      console.log(`🔇 User ${session.user.username} is in quiet hours, skipping alert`);
      
      await prisma.session.update({
        where: { id: session.id },
        data: {
          status: 'TIMEOUT',
          disconnectedAt: new Date(),
          disconnectReason: 'TIMEOUT',
          disconnectMessage: 'Heartbeat timeout (quiet hours - no alert)',
          alertSent: false
        }
      });
      
      return { session, alertSent: false, reason: 'QUIET_HOURS' };
    }

    // Send critical alert
    console.log(`🚨 TIMEOUT: Sending critical alert to user ${session.user.username}`);
    
    // Create persistent log for timeout alert
    await logService.createLog({
      sessionId: session.id,
      userId: session.userId,
      level: 'error',
      message: `🚨 TIMEOUT: ${session.gameName || 'Unknown Game'} - Connection lost (possible crash, kick, or internet failure)`,
    });
    
    const alertData = {
      sessionId: session.id,
      gameName: session.gameName || 'Unknown Game',
      hubName: session.hub?.name || 'Unknown Script',
      reason: 'Connection lost - possible crash, kick, or internet failure',
      lastStatus: session.currentStatus,
      alertSound: session.user.alertSound
    };

    const alertResult = await deviceService.sendCriticalAlertToUser(session.userId, alertData);

    // Start Life or Death Mode alert loop if enabled
    if (session.user.lifeOrDeathMode) {
      await alertLoopService.startAlertLoop(
        session.userId,
        session.id,
        alertData.reason,
        alertData.gameName
      );
    }

    // Update session
    await prisma.session.update({
      where: { id: session.id },
      data: {
        status: 'TIMEOUT',
        disconnectedAt: new Date(),
        disconnectReason: 'TIMEOUT',
        disconnectMessage: 'Heartbeat timeout',
        alertSent: true,
        alertSentAt: new Date(),
        alertDelivered: alertResult.success,
        alertError: alertResult.success ? null : JSON.stringify(alertResult.results)
      }
    });

    return { session, alertSent: true, alertResult };
  }

  /**
   * Check if current time is within user's quiet hours
   */
  isQuietHours(user) {
    if (!user.quietHoursEnabled || !user.quietHoursStart || !user.quietHoursEnd) {
      return false;
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = user.quietHoursStart.split(':').map(Number);
    const [endHour, endMin] = user.quietHoursEnd.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 23:00 to 07:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * Get all active sessions for a user
   */
  async getActiveSessionsByUser(userId) {
    return prisma.session.findMany({
      where: {
        userId,
        status: 'ACTIVE'
      },
      select: {
        id: true,
        gameName: true,
        gamePlaceId: true,
        gameJobId: true,
        executor: true,
        currentStatus: true,
        status: true,
        connectedAt: true,
        lastHeartbeatAt: true,
        hub: {
          select: { name: true }
        }
      },
      orderBy: { connectedAt: 'desc' }
    });
  }

  /**
   * Disconnect all active sessions for a user (e.g., token regeneration)
   */
  async disconnectAllUserSessions(userId, reason = 'TOKEN_REVOKED') {
    return prisma.session.updateMany({
      where: {
        userId,
        status: 'ACTIVE'
      },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        disconnectReason: reason,
        disconnectMessage: 'User token revoked'
      }
    });
  }

  /**
   * Get session statistics for a user
   */
  async getUserStats(userId) {
    const [totalSessions, activeSessions, timeoutSessions] = await Promise.all([
      prisma.session.count({ where: { userId } }),
      prisma.session.count({ where: { userId, status: 'ACTIVE' } }),
      prisma.session.count({ where: { userId, disconnectReason: 'TIMEOUT' } })
    ]);

    return {
      totalSessions,
      activeSessions,
      timeoutSessions,
      alertsTriggered: timeoutSessions
    };
  }

  /**
   * Cleanup old sessions (keep last 30 days)
   */
  async cleanupOldSessions(daysOld = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await prisma.session.deleteMany({
      where: {
        status: { not: 'ACTIVE' },
        updatedAt: { lt: cutoff }
      }
    });

    return result.count;
  }

  /**
   * Cleanup stale active sessions on server startup
   * Mark any ACTIVE sessions as DISCONNECTED (server restarted)
   */
  async cleanupStaleSessions() {
    const result = await prisma.session.updateMany({
      where: {
        status: 'ACTIVE'
      },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        disconnectReason: 'SERVER_SHUTDOWN',
        disconnectMessage: 'Server restarted'
      }
    });

    if (result.count > 0) {
      console.log(`🧹 Cleaned up ${result.count} stale session(s) from previous run`);
    }

    return result.count;
  }
}

export default new SessionService();
