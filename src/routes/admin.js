import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import hubService from '../services/hubService.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import prisma from '../services/database.js';
import config from '../config/index.js';

const router = express.Router();

/**
 * POST /api/v1/admin/login
 * Admin login endpoint
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find admin by email
    const admin = await prisma.admin.findUnique({
      where: { email }
    });

    if (!admin) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, admin.passwordHash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Generate admin JWT token
    const token = jwt.sign(
      { 
        adminId: admin.id, 
        email: admin.email, 
        role: admin.role,
        type: 'admin'
      },
      config.jwt.adminSecret || config.jwt.secret,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

/**
 * GET /api/v1/admin/hubs
 * List all hubs (with optional status filter)
 */
router.get('/hubs', adminAuthMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const result = await hubService.listHubs({
      status,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error listing hubs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list hubs'
    });
  }
});

/**
 * GET /api/v1/admin/hubs/:id
 * Get hub details
 */
router.get('/hubs/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const hub = await hubService.getHubById(id);

    if (!hub) {
      return res.status(404).json({
        success: false,
        error: 'Hub not found'
      });
    }

    const stats = await hubService.getHubStats(id);

    res.json({
      success: true,
      hub,
      stats
    });
  } catch (error) {
    console.error('Error fetching hub:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch hub'
    });
  }
});

/**
 * POST /api/v1/admin/hubs/:id/approve
 * Approve a hub application
 */
router.post('/hubs/:id/approve', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const adminEmail = req.admin.email;

    const hub = await hubService.approveHub(id, adminEmail);

    res.json({
      success: true,
      message: 'Hub approved successfully',
      hub: {
        id: hub.id,
        name: hub.name,
        status: hub.status,
        approvedAt: hub.approvedAt
      }
    });
  } catch (error) {
    console.error('Error approving hub:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve hub'
    });
  }
});

/**
 * POST /api/v1/admin/hubs/:id/suspend
 * Suspend a hub
 */
router.post('/hubs/:id/suspend', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Suspension reason is required'
      });
    }

    const hub = await hubService.suspendHub(id, reason);

    res.json({
      success: true,
      message: 'Hub suspended',
      hub: {
        id: hub.id,
        name: hub.name,
        status: hub.status
      }
    });
  } catch (error) {
    console.error('Error suspending hub:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to suspend hub'
    });
  }
});

/**
 * POST /api/v1/admin/hubs/:id/reject
 * Reject a hub application
 */
router.post('/hubs/:id/reject', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const hub = await hubService.rejectHub(id, reason || 'Application rejected');

    res.json({
      success: true,
      message: 'Hub application rejected',
      hub: {
        id: hub.id,
        name: hub.name,
        status: hub.status
      }
    });
  } catch (error) {
    console.error('Error rejecting hub:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject hub'
    });
  }
});

export default router;
