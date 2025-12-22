import prisma from './database.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * User Service
 * Manages user accounts, tokens, and settings
 */

class UserService {
  /**
   * Generate a simple 6-character connection key
   * Easy to type and remember
   */
  generateUserToken() {
    // Generate a simple 6-character alphanumeric code (uppercase letters + numbers, no confusing chars)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O, 1/I/L to avoid confusion
    let token = '';
    for (let i = 0; i < 6; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const hint = token; // Show full key since it's short
    return { token, hash, hint };
  }

  /**
   * Create a new user
   */
  async createUser({ email, username, password }) {
    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error('EMAIL_EXISTS');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate user token
    const { token, hash, hint } = this.generateUserToken();

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        userToken: token,
        userTokenHash: hash,
        userTokenHint: hint
      }
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt
      },
      // Returned at registration
      userToken: token,
      userTokenHint: hint
    };
  }

  /**
   * Authenticate user by email and password
   */
  async authenticateUser(email, password) {
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user) {
      return null;
    }

    if (user.status !== 'ACTIVE') {
      return { error: 'USER_SUSPENDED' };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return null;
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    return { user };
  }

  /**
   * Validate user token (for SDK authentication)
   * This is the main auth method used by the SDK
   */
  async validateUserToken(userToken) {
    // Support both old format (usr_tk_xxx) and new short format (6 chars)
    if (!userToken || (userToken.length !== 6 && !userToken.startsWith('usr_tk_'))) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { userToken },
      include: {
        devices: {
          where: { isActive: true },
          orderBy: { lastSeenAt: 'desc' }
        }
      }
    });

    if (!user) {
      return null;
    }

    if (user.status !== 'ACTIVE') {
      return { error: 'USER_SUSPENDED' };
    }

    return { user };
  }

  /**
   * Get user by ID
   */
  async getUserById(id) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        userToken: true,
        userTokenHint: true,
        userTokenCreatedAt: true,
        status: true,
        alertSound: true,
        quietHoursEnabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        lifeOrDeathMode: true,
        createdAt: true,
        lastLoginAt: true,
        devices: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            platform: true,
            lastSeenAt: true
          }
        }
      }
    });
  }

  /**
   * Get user's current token info (not the actual token)
   */
  async getUserTokenInfo(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        userTokenHint: true,
        userTokenCreatedAt: true
      }
    });
    return user;
  }

  /**
   * Get user's actual token (for display in app)
   */
  async getUserToken(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        userToken: true,
        userTokenHint: true,
        userTokenCreatedAt: true
      }
    });
    return user;
  }

  /**
   * Regenerate user token (invalidates old token)
   */
  async regenerateUserToken(userId) {
    const { token, hash, hint } = this.generateUserToken();

    // Disconnect all active sessions for this user
    await prisma.session.updateMany({
      where: { 
        userId,
        status: 'ACTIVE'
      },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        disconnectReason: 'TOKEN_REVOKED',
        disconnectMessage: 'User token regenerated'
      }
    });

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        userToken: token,
        userTokenHash: hash,
        userTokenHint: hint,
        userTokenCreatedAt: new Date()
      }
    });

    return {
      userToken: token,
      userTokenHint: hint,
      userTokenCreatedAt: user.userTokenCreatedAt
    };
  }

  /**
   * Update user settings
   */
  async updateSettings(userId, settings) {
    const allowedFields = ['alertSound', 'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'username', 'lifeOrDeathMode'];
    const data = {};
    
    for (const field of allowedFields) {
      if (settings[field] !== undefined) {
        data[field] = settings[field];
      }
    }

    return prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        alertSound: true,
        quietHoursEnabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        lifeOrDeathMode: true
      }
    });
  }

  /**
   * Change user password
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true }
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return { success: false, error: 'Current password is incorrect' };
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash }
    });

    return { success: true };
  }

  /**
   * Delete user account and all associated data (GDPR)
   */
  async deleteAccount(userId, password) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true }
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return { success: false, error: 'Password is incorrect' };
    }

    // Delete all user data in transaction
    await prisma.$transaction(async (tx) => {
      // Delete sessions
      await tx.session.deleteMany({ where: { userId } });
      
      // Delete devices
      await tx.device.deleteMany({ where: { userId } });
      
      // Delete user
      await tx.user.delete({ where: { id: userId } });
    });

    return { success: true };
  }

  /**
   * Get user's active sessions
   */
  async getUserActiveSessions(userId) {
    return prisma.session.findMany({
      where: {
        userId,
        status: 'ACTIVE'
      },
      include: {
        hub: {
          select: {
            name: true,
            slug: true
          }
        }
      },
      orderBy: { connectedAt: 'desc' }
    });
  }

  /**
   * Get user's session history
   */
  async getUserSessionHistory(userId, { page = 1, limit = 20 }) {
    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        where: { userId },
        include: {
          hub: {
            select: { name: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.session.count({ where: { userId } })
    ]);

    return { sessions, total, page, limit };
  }
}

export default new UserService();
