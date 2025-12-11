import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import redisService from './redis.js';
import fcmService from './fcm.js';
import deadmanService from './deadman.js';
import config from '../config/index.js';

// Rate limit configuration (messages per minute)
const RATE_LIMITS = {
  status: { max: 6, windowMs: 60000 },   // 6 per minute
  log: { max: 30, windowMs: 60000 },     // 30 per minute
  notify: { max: 5, windowMs: 60000 }    // 5 per minute
};

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { id, type, userId }
    this.rateLimits = new Map(); // clientId:type -> { count, resetTime }
  }

  // Check rate limit for a client and message type
  checkRateLimit(clientId, type) {
    const limit = RATE_LIMITS[type];
    if (!limit) return true; // No limit for this type

    const key = `${clientId}:${type}`;
    const now = Date.now();
    const record = this.rateLimits.get(key);

    if (!record || now > record.resetTime) {
      // Reset window
      this.rateLimits.set(key, { count: 1, resetTime: now + limit.windowMs });
      return true;
    }

    if (record.count >= limit.max) {
      return false; // Rate limited
    }

    record.count++;
    return true;
  }

  initialize(server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => {
      const clientId = uuidv4();
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      
      if (config.nodeEnv === 'development') {
        console.log(`🔌 New WebSocket connection: ${clientId} from ${clientIp}`);
      }

      // Initialize client metadata
      this.clients.set(ws, {
        id: clientId,
        type: null, // 'roblox' or 'mobile'
        userId: null,
        connectedAt: Date.now(),
        ip: clientIp
      });

      ws.on('message', (data) => this.handleMessage(ws, data));
      ws.on('close', () => this.handleClose(ws));
      ws.on('error', (error) => this.handleError(ws, error));

      // Send welcome message
      this.send(ws, {
        type: 'connected',
        clientId,
        timestamp: Date.now()
      });
    });

    console.log('✓ WebSocket server initialized on /ws');
  }

  async handleMessage(ws, data) {
    const client = this.clients.get(ws);
    
    try {
      const message = JSON.parse(data.toString());
      
      if (config.nodeEnv === 'development') {
        console.log(`📨 Message from ${client.id}:`, message.type);
      }

      switch (message.type) {
        case 'connect':
          await this.handleRobloxConnect(ws, client, message);
          break;

        case 'ping':
        case 'heartbeat':
          await this.handleHeartbeat(ws, client, message);
          break;

        case 'log':
          await this.handleLog(ws, client, message);
          break;

        case 'status':
          await this.handleStatusUpdate(ws, client, message);
          break;

        case 'notify':
          await this.handleNotify(ws, client, message);
          break;

        case 'alert':
          await this.handleAlert(ws, client, message);
          break;

        case 'disconnect':
          await this.handleExplicitDisconnect(ws, client, message);
          break;

        case 'register_device':
          await this.handleMobileRegister(ws, client, message);
          break;

        case 'command':
          await this.handleCommand(ws, client, message);
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
          this.send(ws, {
            type: 'error',
            message: 'Unknown message type'
          });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.send(ws, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  }

  async handleRobloxConnect(ws, client, message) {
    const { connectionKey, gameInfo } = message;

    if (!connectionKey) {
      this.send(ws, {
        type: 'error',
        message: 'Connection key required'
      });
      return;
    }

    // Validate connection key
    const userId = await redisService.getConnectionKey(connectionKey);
    
    if (!userId) {
      console.warn(`Invalid connection key: ${connectionKey}`);
      this.send(ws, {
        type: 'error',
        message: 'Invalid or expired connection key'
      });
      ws.close();
      return;
    }

    // Update client metadata
    client.type = 'roblox';
    client.userId = userId;
    this.clients.set(ws, client);

    // Store active connection in Redis
    await redisService.setActiveConnection(client.id, userId, gameInfo || {});
    
    if (config.nodeEnv === 'development') {
      console.log(`📋 Game info received:`, JSON.stringify(gameInfo, null, 2));
    }

    // Start Dead Man's Switch monitoring
    deadmanService.startMonitoring(client.id, {
      userId,
      gameInfo,
      clientId: client.id
    });

    // Delete the used connection key (single use)
    await redisService.deleteConnectionKey(connectionKey);

    console.log(`✓ Roblox client authenticated: ${client.id} for user ${userId}`);
    
    this.send(ws, {
      type: 'authenticated',
      sessionId: client.id,
      message: 'Connection established'
    });

    // Notify mobile apps via WebSocket that new session started
    this.notifyMobileApps(userId, {
      type: 'session_connected',
      sessionId: client.id,
      gameName: gameInfo?.name || 'Unknown Game',
      placeId: gameInfo?.placeId,
      executor: gameInfo?.executor,
      timestamp: Date.now()
    });
    // FCM only for critical alerts - session_connected uses WebSocket only
  }

  async handleHeartbeat(ws, client, message) {
    if (client.type !== 'roblox') {
      return;
    }

    // Reset the Dead Man's Switch timer
    const success = deadmanService.resetTimer(client.id);

    if (success) {
      this.send(ws, {
        type: 'pong',
        timestamp: Date.now()
      });
    }
  }

  async handleLog(ws, client, message) {
    if (client.type !== 'roblox') {
      return;
    }

    // Rate limit log messages
    if (!this.checkRateLimit(client.id, 'log')) {
      this.send(ws, {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'Log messages limited to 30 per minute'
      });
      return;
    }

    const { message: logMessage, level } = message;

    // Forward log to mobile device via WebSocket
    for (const [mobileWs, mobileClient] of this.clients.entries()) {
      if (mobileClient.type === 'mobile' && 
          mobileClient.userId === client.userId && 
          mobileWs.readyState === WebSocket.OPEN) {
        mobileWs.send(JSON.stringify({
          type: 'log',
          data: {
            message: logMessage,
            level: level || 'info',
            timestamp: Date.now()
          }
        }));
      }
    }

    // Optionally store in Redis for log history
    await redisService.client.lPush(
      `logs:${client.userId}`,
      JSON.stringify({
        sessionId: client.id,
        message: logMessage,
        level,
        timestamp: Date.now()
      })
    );
    await redisService.client.lTrim(`logs:${client.userId}`, 0, 199);
  }

  async handleStatusUpdate(ws, client, message) {
    const { status, data } = message;

    if (client.type !== 'roblox') return;

    // Rate limit status updates
    if (!this.checkRateLimit(client.id, 'status')) {
      this.send(ws, {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'Status updates limited to 6 per minute'
      });
      return;
    }

    // Update session status in Redis
    await redisService.client.hSet(`active:${client.id}`, 'status', status);

    // Forward to mobile via WebSocket (no FCM for status - too spammy)
    for (const [mobileWs, mobileClient] of this.clients.entries()) {
      if (mobileClient.type === 'mobile' && 
          mobileClient.userId === client.userId && 
          mobileWs.readyState === WebSocket.OPEN) {
        mobileWs.send(JSON.stringify({
          type: 'status_update',
          data: { status, ...data, timestamp: Date.now() }
        }));
      }
    }
  }

  async handleNotify(ws, client, message) {
    if (client.type !== 'roblox') return;

    // Rate limit notifications strictly
    if (!this.checkRateLimit(client.id, 'notify')) {
      this.send(ws, {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'Notifications limited to 5 per minute'
      });
      return;
    }

    const { title, message: notifyMessage } = message;
    if (!title || !notifyMessage) {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_PARAMS',
        message: 'Title and message are required'
      });
      return;
    }

    // Send via WebSocket to mobile
    for (const [mobileWs, mobileClient] of this.clients.entries()) {
      if (mobileClient.type === 'mobile' && 
          mobileClient.userId === client.userId && 
          mobileWs.readyState === WebSocket.OPEN) {
        mobileWs.send(JSON.stringify({
          type: 'notification',
          data: { title, message: notifyMessage, timestamp: Date.now() }
        }));
      }
    }

    // Also send FCM push notification
    const userDevice = await redisService.getUserDevice(client.userId);
    if (userDevice && userDevice.fcmToken) {
      fcmService.sendNotification(userDevice.fcmToken, {
        title,
        body: notifyMessage,
        data: { sessionId: client.id }
      });
    }
  }

  async handleAlert(ws, client, message) {
    if (client.type !== 'roblox') return;

    // Rate limit alerts strictly - same as notify (5 per minute)
    if (!this.checkRateLimit(client.id, 'notify')) {
      this.send(ws, {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'Alerts limited to 5 per minute'
      });
      return;
    }

    const { title, message: alertMessage, reason } = message;
    const alertReason = reason || alertMessage || 'Critical alert from script';

    if (!alertReason) {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_PARAMS',
        message: 'Alert reason is required'
      });
      return;
    }

    const connection = await redisService.getActiveConnection(client.id);
    const gameName = connection?.gameInfo?.name || 'Unknown Game';

    // Send via WebSocket to mobile with critical flag
    for (const [mobileWs, mobileClient] of this.clients.entries()) {
      if (mobileClient.type === 'mobile' && 
          mobileClient.userId === client.userId && 
          mobileWs.readyState === WebSocket.OPEN) {
        mobileWs.send(JSON.stringify({
          type: 'critical_alert',
          data: { 
            title: title || '🚨 CRITICAL ALERT',
            reason: alertReason,
            gameName,
            sessionId: client.id,
            timestamp: Date.now() 
          }
        }));
      }
    }

    // Send FCM critical alert with alarm sound
    const userDevice = await redisService.getUserDevice(client.userId);
    if (userDevice && userDevice.fcmToken) {
      await fcmService.sendCriticalAlert(userDevice.fcmToken, {
        sessionId: client.id,
        reason: alertReason,
        gameName,
        userId: client.userId
      });
    }

    console.log(`🚨 Critical alert sent for ${client.id}: ${alertReason}`);
  }

  async handleExplicitDisconnect(ws, client, message) {
    if (client.type !== 'roblox') {
      return;
    }

    const reason = message.reason || 'Manual disconnect';
    await deadmanService.handleExplicitDisconnect(client.id, reason);

    // Get connection info for notification
    const connection = await redisService.getActiveConnection(client.id);
    
    if (connection) {
      // Notify connected mobile apps via WebSocket (works in Expo Go!)
      this.notifyMobileApps(connection.userId, {
        type: 'session_disconnected',
        sessionId: client.id,
        reason: reason,
        gameName: connection.gameInfo?.name || 'Unknown Game',
        timestamp: Date.now()
      });
    }

    this.send(ws, {
      type: 'acknowledged',
      message: 'Disconnect processed'
    });

    ws.close();
  }

  async handleMobileRegister(ws, client, message) {
    const { userId, fcmToken } = message;

    if (!userId) {
      this.send(ws, {
        type: 'error',
        message: 'userId required'
      });
      return;
    }

    // Update client metadata
    client.type = 'mobile';
    client.userId = userId;
    this.clients.set(ws, client);

    // Store FCM token in Redis (optional for Expo Go testing)
    if (fcmToken && fcmToken !== 'EXPO_GO_TESTING') {
      await redisService.setUserDevice(userId, fcmToken);
      console.log(`✓ Mobile device registered for user ${userId} with FCM token`);
    } else {
      console.log(`✓ Mobile device registered for user ${userId} (WebSocket alerts only, no FCM)`);
    }

    // Send current sessions
    const sessions = await redisService.getUserSessions(userId);

    this.send(ws, {
      type: 'registered',
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        gameName: s.gameInfo?.name || 'Unknown Game',
        placeId: s.gameInfo?.placeId,
        executor: s.gameInfo?.executor,
        connectedAt: s.connectedAt,
        lastHeartbeat: s.lastHeartbeat,
        status: s.status
      }))
    });
  }

  async handleCommand(ws, client, message) {
    if (client.type !== 'mobile') {
      return;
    }

    const { targetSessionId, command, data } = message;

    // Find the target Roblox client
    for (const [targetWs, targetClient] of this.clients.entries()) {
      if (targetClient.id === targetSessionId && targetClient.type === 'roblox') {
        this.send(targetWs, {
          type: 'command',
          command,
          data
        });
        
        this.send(ws, {
          type: 'command_sent',
          sessionId: targetSessionId
        });
        
        return;
      }
    }

    this.send(ws, {
      type: 'error',
      message: 'Target session not found'
    });
  }

  async handleClose(ws) {
    const client = this.clients.get(ws);
    
    if (!client) return;

    if (config.nodeEnv === 'development') {
      console.log(`🔌 WebSocket disconnected: ${client.id} (${client.type})`);
    }

    if (client.type === 'roblox') {
      // Get connection info before it's deleted
      const connection = await redisService.getActiveConnection(client.id);
      
      // Abrupt disconnect - trigger Dead Man's Switch with grace period
      await deadmanService.handleAbruptDisconnect(client.id);
      
      // Notify mobile apps immediately via WebSocket
      if (connection) {
        this.notifyMobileApps(connection.userId, {
          type: 'session_disconnected',
          sessionId: client.id,
          reason: 'Connection lost - game may have crashed',
          gameName: connection.gameInfo?.name || 'Unknown Game',
          timestamp: Date.now()
        });
      }
    }

    this.clients.delete(ws);
  }

  // Helper method to notify all connected mobile apps for a user
  notifyMobileApps(userId, data) {
    for (const [ws, client] of this.clients.entries()) {
      if (client.type === 'mobile' && client.userId === userId) {
        console.log(`📱 Sending alert to mobile app for user ${userId}`);
        this.send(ws, data);
      }
    }
  }

  handleError(ws, error) {
    const client = this.clients.get(ws);
    console.error(`WebSocket error for ${client?.id}:`, error.message);
  }

  send(ws, data) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  broadcast(data, filter = null) {
    for (const [ws, client] of this.clients.entries()) {
      if (!filter || filter(client)) {
        this.send(ws, data);
      }
    }
  }

  getStats() {
    const stats = {
      total: this.clients.size,
      roblox: 0,
      mobile: 0
    };

    for (const client of this.clients.values()) {
      if (client.type === 'roblox') stats.roblox++;
      if (client.type === 'mobile') stats.mobile++;
    }

    return stats;
  }
}

export default new WebSocketService();
