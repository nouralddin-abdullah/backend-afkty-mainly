import jwt from 'jsonwebtoken';
import config from '../config/index.js';

/**
 * Admin Authentication Middleware
 * Validates admin JWT token for admin-only routes
 */
export const adminAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required'
      });
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, config.jwt.adminSecret || config.jwt.secret);
      
      // Check if this is an admin token (either by isAdmin flag or type)
      if (!decoded.isAdmin && decoded.type !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }

      req.admin = {
        id: decoded.adminId,
        email: decoded.email,
        role: decoded.role
      };

      next();
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        error: 'Invalid admin token'
      });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * Generate admin JWT token
 */
export const generateAdminToken = (admin) => {
  return jwt.sign(
    {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      isAdmin: true
    },
    config.jwt.adminSecret || config.jwt.secret,
    { expiresIn: '24h' }
  );
};
