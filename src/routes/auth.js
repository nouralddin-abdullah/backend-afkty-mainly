import express from 'express';
import { hashPassword, comparePassword, generateToken } from '../utils/auth.js';
import redisService from '../services/redis.js';
import config from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * POST /api/v1/auth/register
 * Register a new user account
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Check if user exists
    const existingUser = await redisService.userExists(email);
    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const userId = uuidv4();
    const user = {
      id: userId,
      email,
      username: username || email.split('@')[0],
      passwordHash,
      createdAt: Date.now()
    };

    // Save to Redis
    await redisService.setUser(email, user);

    // Debug: Log registered user
    if (config.nodeEnv === 'development') {
      console.log(`✓ User registered: ${email} (ID: ${userId})`);
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email
    });

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      },
      token
    });
  } catch (error) {
    if (config.nodeEnv === 'development') {
      console.error('Registration error:', error);
    }
    res.status(500).json({
      error: 'Registration failed'
    });
  }
});

/**
 * POST /api/v1/auth/login
 * Login and get JWT token
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Find user in Redis
    const user = await redisService.getUser(email);
    
    if (!user) {
      if (config.nodeEnv === 'development') {
        const allUsers = await redisService.getAllUsers();
        console.log(`Login failed: User ${email} not found. Registered users: ${allUsers.length}`);
      }
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    // Verify password
    const isValid = await comparePassword(password, user.passwordHash);
    
    if (!isValid) {
      if (config.nodeEnv === 'development') {
        console.log(`Login failed: Invalid password for ${email}`);
      }
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email
    });

    console.log(`✓ User ${email} logged in successfully`);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      },
      token
    });
  } catch (error) {
    if (config.nodeEnv === 'development') {
      console.error('Login error:', error);
    }
    res.status(500).json({
      error: 'Login failed'
    });
  }
});
/**
 * GET /api/v1/auth/debug/users (development only)
 * List registered users for debugging
 */
if (config.nodeEnv === 'development') {
  router.get('/debug/users', async (req, res) => {
    try {
      const allUsers = await redisService.getAllUsers();
      const userList = allUsers.map(u => ({
        id: u.id,
        email: u.email,
        username: u.username,
        createdAt: u.createdAt
      }));
      
      res.json({
        count: userList.length,
        users: userList
      });
    } catch (error) {
      console.error('Debug users error:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });
}

export default router;
