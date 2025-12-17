import express from 'express';
import userService from '../services/userService.js';
import deviceService from '../services/deviceService.js';
import sessionService from '../services/sessionService.js';
import redisService from '../services/redis.js';
import { authMiddleware, addToBlacklist } from '../middleware/auth.js';
import { generateToken } from '../utils/auth.js';

const router = express.Router();

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

function validateEmail(email) {
  return EMAIL_REGEX.test(email);
}

function validateUsername(username) {
  return USERNAME_REGEX.test(username);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// ============================================================================
// RATE LIMITING (for login)
// ============================================================================

const loginAttempts = new Map(); // IP -> { count, firstAttempt }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  
  if (!record || now > record.firstAttempt + LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }
  
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    const resetIn = Math.ceil((record.firstAttempt + LOGIN_WINDOW_MS - now) / 1000 / 60);
    return { allowed: false, resetIn };
  }
  
  record.count++;
  return { allowed: true };
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// ============================================================================
// PUBLIC ROUTES (no auth required)
// ============================================================================

/**
 * POST /api/v1/users/register
 * Register a new user account
 */
router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Valid email address is required'
      });
    }

    // Validate password (min 8 characters)
    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    // Validate or generate username
    let finalUsername = username;
    if (!finalUsername) {
      // Generate from email, ensure it matches rules
      finalUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30);
      if (finalUsername.length < 3) {
        finalUsername = finalUsername + '_user';
      }
    } else if (!validateUsername(finalUsername)) {
      return res.status(400).json({
        success: false,
        error: 'Username must be 3-30 characters, alphanumeric and underscores only'
      });
    }

    const result = await userService.createUser({
      email: email.toLowerCase().trim(),
      username: finalUsername,
      password
    });

    // Generate JWT for session
    const token = generateToken({
      userId: result.user.id,
      email: result.user.email
    });

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: result.user,
      token,
      // The user token for SDK - shown at registration
      userToken: result.userToken,
      userTokenHint: result.userTokenHint,
      instructions: {
        step1: 'Save your User Token - paste it in script configs',
        step2: 'Register your phone in the mobile app',
        step3: 'Start using scripts with AFKTY integration!'
      }
    });
  } catch (error) {
    if (error.message === 'EMAIL_EXISTS') {
      return res.status(409).json({
        success: false,
        error: 'Email already registered'
      });
    }
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

/**
 * POST /api/v1/users/login
 * Login and get JWT token
 */
router.post('/login', async (req, res) => {
  try {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Check rate limit
    const rateCheck = checkLoginRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many login attempts. Try again in ${rateCheck.resetIn} minutes.`
      });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const result = await userService.authenticateUser(email.toLowerCase().trim(), password);

    if (!result) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    if (result.error === 'USER_SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: 'Account suspended'
      });
    }

    // Success - reset rate limit
    resetLoginAttempts(clientIp);

    // Generate JWT
    const token = generateToken({
      userId: result.user.id,
      email: result.user.email
    });

    res.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

/**
 * POST /api/v1/users/logout
 * Logout and invalidate JWT token
 */
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization.substring(7);
    
    // Add token to blacklist
    await addToBlacklist(token);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

/**
 * POST /api/v1/users/validate-token
 * Validate a user token (for debugging/testing)
 */
router.post('/validate-token', async (req, res) => {
  try {
    const { userToken } = req.body;

    if (!userToken) {
      return res.status(400).json({
        success: false,
        error: 'User token is required'
      });
    }

    const result = await userService.validateUserToken(userToken);

    if (!result) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invalid user token'
      });
    }

    if (result.error) {
      return res.json({
        success: false,
        valid: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      valid: true,
      user: {
        username: result.user.username,
        hasDevices: result.user.devices.length > 0
      }
    });
  } catch (error) {
    console.error('Error validating token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate token'
    });
  }
});

// ============================================================================
// PROTECTED ROUTES (auth required)
// ============================================================================

/**
 * GET /api/v1/users/me
 * Get current user profile
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const stats = await sessionService.getUserStats(req.user.userId);

    res.json({
      success: true,
      user,
      stats
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    });
  }
});

/**
 * PATCH /api/v1/users/me
 * Update user settings
 */
router.patch('/me', authMiddleware, async (req, res) => {
  try {
    const settings = req.body;
    const user = await userService.updateSettings(req.user.userId, settings);

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings'
    });
  }
});

// ============================================================================
// USER TOKEN MANAGEMENT
// ============================================================================

/**
 * GET /api/v1/users/me/token
 * Get current user token
 */
router.get('/me/token', authMiddleware, async (req, res) => {
  try {
    const tokenInfo = await userService.getUserToken(req.user.userId);

    if (!tokenInfo) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      userToken: tokenInfo.userToken,
      userTokenHint: tokenInfo.userTokenHint,
      createdAt: tokenInfo.userTokenCreatedAt,
      instructions: 'Paste this token in your script configs to receive alerts'
    });
  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch token'
    });
  }
});

/**
 * POST /api/v1/users/me/token/regenerate
 * Regenerate user token (invalidates old one)
 */
router.post('/me/token/regenerate', authMiddleware, async (req, res) => {
  try {
    const result = await userService.regenerateUserToken(req.user.userId);

    res.json({
      success: true,
      message: 'Token regenerated. All active sessions have been disconnected.',
      userToken: result.userToken,
      userTokenHint: result.userTokenHint,
      createdAt: result.userTokenCreatedAt,
      warning: 'Update your script configs with the new token!'
    });
  } catch (error) {
    console.error('Error regenerating token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate token'
    });
  }
});

/**
 * POST /api/v1/users/me/password
 * Change password
 */
router.post('/me/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters'
      });
    }

    const result = await userService.changePassword(req.user.userId, currentPassword, newPassword);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to change password'
      });
    }

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

/**
 * DELETE /api/v1/users/me
 * Delete account (GDPR compliance)
 */
router.delete('/me', authMiddleware, async (req, res) => {
  try {
    const { password, confirmDelete } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required to delete account'
      });
    }

    if (confirmDelete !== 'DELETE_MY_ACCOUNT') {
      return res.status(400).json({
        success: false,
        error: 'Please confirm deletion by setting confirmDelete to "DELETE_MY_ACCOUNT"'
      });
    }

    const result = await userService.deleteAccount(req.user.userId, password);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to delete account'
      });
    }

    // Invalidate current token
    const token = req.headers.authorization.substring(7);
    await addToBlacklist(token);

    res.json({
      success: true,
      message: 'Account deleted successfully. All your data has been removed.'
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
});

// ============================================================================
// DEVICE MANAGEMENT
// ============================================================================

/**
 * GET /api/v1/users/me/devices
 * Get user's registered devices
 */
router.get('/me/devices', authMiddleware, async (req, res) => {
  try {
    const devices = await deviceService.getUserDevices(req.user.userId);

    res.json({
      success: true,
      devices
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch devices'
    });
  }
});

/**
 * POST /api/v1/users/me/devices
 * Register a new device (from mobile app)
 */
router.post('/me/devices', authMiddleware, async (req, res) => {
  try {
    const { fcmToken, name, platform, appVersion } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        error: 'FCM token is required'
      });
    }

    const device = await deviceService.registerDevice(req.user.userId, {
      fcmToken,
      name,
      platform,
      appVersion
    });

    res.status(201).json({
      success: true,
      message: 'Device registered for push notifications',
      device: {
        id: device.id,
        name: device.name,
        platform: device.platform
      }
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register device'
    });
  }
});

/**
 * PUT /api/v1/users/me/devices/token
 * Update FCM token (token refresh)
 */
router.put('/me/devices/token', authMiddleware, async (req, res) => {
  try {
    const { oldToken, newToken } = req.body;

    if (!oldToken || !newToken) {
      return res.status(400).json({
        success: false,
        error: 'Both old and new tokens are required'
      });
    }

    const device = await deviceService.updateFcmToken(oldToken, newToken);

    if (!device) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    res.json({
      success: true,
      message: 'FCM token updated'
    });
  } catch (error) {
    console.error('Error updating FCM token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update FCM token'
    });
  }
});

/**
 * DELETE /api/v1/users/me/devices/:id
 * Remove a device
 */
router.delete('/me/devices/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const device = await deviceService.removeDevice(req.user.userId, id);

    if (!device) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    res.json({
      success: true,
      message: 'Device removed'
    });
  } catch (error) {
    console.error('Error removing device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove device'
    });
  }
});

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * GET /api/v1/users/me/sessions
 * Get user's active sessions
 */
router.get('/me/sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await sessionService.getActiveSessionsByUser(req.user.userId);

    res.json({
      success: true,
      sessions: sessions.map(s => ({
        id: s.id,
        gameName: s.gameName,
        gamePlaceId: s.gamePlaceId,
        gameJobId: s.gameJobId,
        executor: s.executor,
        hubName: s.hub?.name,
        status: 'ACTIVE',
        currentStatus: s.currentStatus,
        connectedAt: s.connectedAt,
        lastHeartbeat: s.lastHeartbeatAt
      }))
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions'
    });
  }
});

/**
 * GET /api/v1/users/me/history
 * Get user's session history
 */
router.get('/me/history', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const result = await userService.getUserSessionHistory(req.user.userId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history'
    });
  }
});

/**
 * DELETE /api/v1/users/me/sessions/:id
 * Stop/disconnect a specific session
 */
router.delete('/me/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the session and verify it belongs to the user
    const session = await sessionService.getSessionById(id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    if (session.userId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to stop this session'
      });
    }
    
    // Disconnect the session
    await sessionService.disconnectSessionById(id, 'MANUAL', 'Stopped by user from mobile app');
    
    res.json({
      success: true,
      message: 'Session stopped'
    });
  } catch (error) {
    console.error('Error stopping session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop session'
    });
  }
});

export default router;
