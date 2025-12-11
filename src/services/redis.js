import { createClient } from 'redis';
import config from '../config/index.js';

class RedisService {
  constructor() {
    this.client = null;
  }

  async connect() {
    try {
      this.client = createClient({
        username: config.redis.username,
        password: config.redis.password,
        socket: {
          host: config.redis.host,
          port: config.redis.port
        }
      });

      this.client.on('error', (err) => console.error('Redis Client Error:', err));
      this.client.on('connect', () => {
        if (config.nodeEnv === 'development') {
          console.log('✓ Redis connected');
        }
      });

      await this.client.connect();
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  // Session Management
  async setSession(sessionId, data, expirySeconds = 3600) {
    await this.client.setEx(
      `session:${sessionId}`,
      expirySeconds,
      JSON.stringify(data)
    );
  }

  async getSession(sessionId) {
    const data = await this.client.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(sessionId) {
    await this.client.del(`session:${sessionId}`);
  }

  // User Management (persistent storage)
  async setUser(email, userData) {
    await this.client.set(`user:${email}`, JSON.stringify(userData));
  }

  async getUser(email) {
    const data = await this.client.get(`user:${email}`);
    return data ? JSON.parse(data) : null;
  }

  async userExists(email) {
    return await this.client.exists(`user:${email}`) === 1;
  }

  async getAllUsers() {
    const keys = await this.client.keys('user:*');
    const users = [];
    for (const key of keys) {
      // Skip device mapping keys (user:{userId} vs user:{email})
      if (key.includes('@')) {
        const data = await this.client.get(key);
        if (data) users.push(JSON.parse(data));
      }
    }
    return users;
  }

  // User to Device Mapping
  async setUserDevice(userId, fcmToken) {
    await this.client.hSet(`user:${userId}`, 'fcmToken', fcmToken);
    await this.client.hSet(`user:${userId}`, 'lastSeen', Date.now().toString());
  }

  async getUserDevice(userId) {
    return await this.client.hGetAll(`user:${userId}`);
  }

  // Connection Key Management
  async setConnectionKey(key, userId, expirySeconds = 300) {
    await this.client.setEx(
      `connkey:${key}`,
      expirySeconds,
      userId
    );
  }

  async getConnectionKey(key) {
    return await this.client.get(`connkey:${key}`);
  }

  async deleteConnectionKey(key) {
    await this.client.del(`connkey:${key}`);
  }

  // Active Roblox Connections (sessionId -> userId mapping)
  async setActiveConnection(sessionId, userId, gameInfo) {
    const data = {
      userId,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      gameInfo: JSON.stringify(gameInfo),
      status: 'online'
    };
    
    await this.client.hSet(`active:${sessionId}`, data);
    await this.client.sAdd(`user:${userId}:sessions`, sessionId);
  }

  async getActiveConnection(sessionId) {
    const data = await this.client.hGetAll(`active:${sessionId}`);
    if (data && data.gameInfo) {
      data.gameInfo = JSON.parse(data.gameInfo);
    }
    return Object.keys(data).length ? data : null;
  }

  async updateHeartbeat(sessionId) {
    await this.client.hSet(`active:${sessionId}`, 'lastHeartbeat', Date.now().toString());
  }

  async deleteActiveConnection(sessionId) {
    const conn = await this.getActiveConnection(sessionId);
    if (conn) {
      await this.client.sRem(`user:${conn.userId}:sessions`, sessionId);
    }
    await this.client.del(`active:${sessionId}`);
  }

  async getUserSessions(userId) {
    const sessionIds = await this.client.sMembers(`user:${userId}:sessions`);
    const sessions = [];
    
    for (const sessionId of sessionIds) {
      const session = await this.getActiveConnection(sessionId);
      if (session) {
        sessions.push({ sessionId, ...session });
      }
    }
    
    return sessions;
  }

  // Statistics
  async getStats() {
    const keys = await this.client.keys('active:*');
    return {
      activeConnections: keys.length,
      timestamp: Date.now()
    };
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
    }
  }
}

export default new RedisService();
