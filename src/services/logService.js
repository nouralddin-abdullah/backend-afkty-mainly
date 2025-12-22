import prisma from './database.js';

/**
 * Log Service
 * Handles persistent storage and retrieval of session logs
 */

class LogService {
  /**
   * Create a new log entry
   */
  async createLog({ sessionId, userId, level, message }) {
    try {
      return await prisma.sessionLog.create({
        data: {
          sessionId,
          userId,
          level: this.normalizeLevel(level),
          message: message?.substring(0, 2000) || '', // Limit message length
        },
      });
    } catch (error) {
      console.error('Failed to create log:', error.message);
      return null;
    }
  }

  /**
   * Get logs for a user (across all sessions)
   * Used on page load to show recent logs
   */
  async getLogsByUser(userId, options = {}) {
    const { limit = 100, offset = 0, sessionId = null } = options;

    const where = { userId };
    if (sessionId) {
      where.sessionId = sessionId;
    }

    return prisma.sessionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        sessionId: true,
        level: true,
        message: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get logs for a specific session
   */
  async getLogsBySession(sessionId, options = {}) {
    const { limit = 100, offset = 0 } = options;

    return prisma.sessionLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        sessionId: true,
        level: true,
        message: true,
        createdAt: true,
      },
    });
  }

  /**
   * Delete old logs (for cleanup job)
   * Keeps logs for 7 days by default
   */
  async deleteOldLogs(daysToKeep = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await prisma.sessionLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    console.log(`🧹 Cleaned up ${result.count} old logs`);
    return result.count;
  }

  /**
   * Get log count for a user
   */
  async getLogCount(userId, sessionId = null) {
    const where = { userId };
    if (sessionId) {
      where.sessionId = sessionId;
    }

    return prisma.sessionLog.count({ where });
  }

  /**
   * Normalize log level to match Prisma enum
   */
  normalizeLevel(level) {
    const normalized = level?.toUpperCase();
    if (['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(normalized)) {
      return normalized;
    }
    return 'INFO';
  }
}

export default new LogService();
