import { verifyToken } from '../utils/auth.js';
import redisService from '../services/redis.js';

// Token blacklist prefix
const BLACKLIST_PREFIX = 'jwt:blacklist:';
const BLACKLIST_TTL = 30 * 24 * 60 * 60; // 30 days (match JWT expiry)

/**
 * Add a JWT token to the blacklist (for logout)
 */
export async function addToBlacklist(token) {
  try {
    const decoded = verifyToken(token);
    if (decoded && decoded.exp) {
      // Set TTL to remaining token lifetime
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0 && redisService.client) {
        await redisService.client.setEx(`${BLACKLIST_PREFIX}${token}`, ttl, '1');
        return true;
      }
    }
  } catch (error) {
    console.error('Error blacklisting token:', error);
  }
  return false;
}

/**
 * Check if token is blacklisted
 */
async function isBlacklisted(token) {
  try {
    if (redisService.client) {
      const result = await redisService.client.get(`${BLACKLIST_PREFIX}${token}`);
      return result === '1';
    }
  } catch (error) {
    console.error('Error checking blacklist:', error);
  }
  return false;
}

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'No token provided'
    });
  }

  const token = authHeader.substring(7);
  
  // Check blacklist first
  if (await isBlacklisted(token)) {
    return res.status(401).json({
      error: 'Token has been invalidated'
    });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      error: 'Invalid or expired token'
    });
  }

  req.user = decoded;
  next();
}
