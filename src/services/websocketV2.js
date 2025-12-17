import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import hubService from './hubService.js';
import userService from './userService.js';
import sessionService from './sessionService.js';
import deviceService from './deviceService.js';
import redisService from './redis.js';
import config from '../config/index.js';

/**
 * Rate limit configuration (messages per minute)
 */
const RATE_LIMITS = {
  status: { max: 6, windowMs: 60000 },
  log: { max: 30, windowMs: 60000 },
  notify: { max: 5, windowMs: 60000 },
  alert: { max: 5, windowMs: 60000 }
};

/**
 * Error codes sent to SDK
 */
const ERROR_CODES = {
  INVALID_HUB_KEY: 'INVALID_HUB_KEY',
  HUB_NOT_APPROVED: 'HUB_NOT_APPROVED',
  HUB_SUSPENDED: 'HUB_SUSPENDED',
  INVALID_USER_TOKEN: 'INVALID_USER_TOKEN',
  USER_SUSPENDED: 'USER_SUSPENDED',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  INVALID_PARAMS: 'INVALID_PARAMS',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND'
};

class WebSocketServiceV2 {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> ClientInfo
    this.rateLimits = new Map();
    this.heartbeatTimers = new Map(); // sessionId -> timer
  }

  /**
   * Check rate limit
   */
  checkRateLimit(clientId, type) {
    const limit = RATE_LIMITS[type];
    if (!limit) return true;

    const key = `${clientId}:${type}`;
    const now = Date.now();
    const record = this.rateLimits.get(key);

    if (!record || now > record.resetTime) {
      this.rateLimits.set(key, { count: 1, resetTime: now + limit.windowMs });
      return true;
    }

    if (record.count >= limit.max) {
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => {
      const clientId = uuidv4();
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      
      if (config.nodeEnv === 'development') {
        console.log(`🔌 New WebSocket connection: ${clientId.substring(0, 8)}... from ${clientIp}`);
      }

      // Initialize client metadata
      this.clients.set(ws, {
        id: clientId,
        type: null,           // 'roblox' or 'mobile'
        userId: null,
        hubId: null,
        sessionId: null,
        authenticated: false,
        connectedAt: Date.now(),
        ip: clientIp
      });

      ws.on('message', (data) => this.handleMessage(ws, data));
      ws.on('close', () => this.handleClose(ws));
      ws.on('error', (error) => this.handleError(ws, error));

      // Send welcome
      this.send(ws, {
        type: 'connected',
        clientId,
        serverVersion: '2.0.0',
        timestamp: Date.now()
      });
    });

    console.log('✓ WebSocket server v2 initialized on /ws');
  }

  /**
   * Main message handler
   */
  async handleMessage(ws, data) {
    const client = this.clients.get(ws);
    
    try {
      const message = JSON.parse(data.toString());
      
      if (config.nodeEnv === 'development') {
        console.log(`📨 [${client.id.substring(0, 8)}] ${message.type}`);
      }

      switch (message.type) {
        // === Authentication ===
        case 'connect':
          await this.handleConnect(ws, client, message);
          break;

        // === Heartbeat ===
        case 'ping':
        case 'heartbeat':
          await this.handleHeartbeat(ws, client);
          break;

        // === From SDK (Roblox) ===
        case 'log':
          await this.handleLog(ws, client, message);
          break;

        case 'status':
          await this.handleStatus(ws, client, message);
          break;

        case 'notify':
          await this.handleNotify(ws, client, message);
          break;

        case 'alert':
          await this.handleAlert(ws, client, message);
          break;

        case 'disconnect':
          await this.handleDisconnect(ws, client, message);
          break;

        // === From Mobile App ===
        case 'authenticate':
          await this.handleMobileAuthenticate(ws, client, message);
          break;

        case 'register_device':
          await this.handleMobileRegister(ws, client, message);
          break;

        case 'command':
          await this.handleCommand(ws, client, message);
          break;

        default:
          this.sendError(ws, ERROR_CODES.INVALID_MESSAGE, `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.sendError(ws, ERROR_CODES.INVALID_MESSAGE, 'Invalid message format');
    }
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  /**
   * Handle SDK connection with hubKey + userToken
   */
  async handleConnect(ws, client, message) {
    const { hubKey, userToken, gameInfo } = message;

    // === Validate Hub API Key ===
    if (!hubKey) {
      this.sendError(ws, ERROR_CODES.INVALID_HUB_KEY, 'Hub API key is required');
      return ws.close();
    }

    const hubResult = await hubService.validateApiKey(hubKey);
    
    if (!hubResult) {
      console.warn(`❌ Invalid hub key attempted: ${hubKey.substring(0, 15)}...`);
      this.sendError(ws, ERROR_CODES.INVALID_HUB_KEY, 'Invalid hub API key');
      return ws.close();
    }

    if (hubResult.error) {
      console.warn(`❌ Hub not approved: ${hubResult.status}`);
      const code = hubResult.status === 'SUSPENDED' ? ERROR_CODES.HUB_SUSPENDED : ERROR_CODES.HUB_NOT_APPROVED;
      this.sendError(ws, code, `Hub is ${hubResult.status.toLowerCase()}`);
      return ws.close();
    }

    // === Validate User Token ===
    if (!userToken) {
      this.sendError(ws, ERROR_CODES.INVALID_USER_TOKEN, 'User token is required');
      return ws.close();
    }

    const userResult = await userService.validateUserToken(userToken);

    if (!userResult) {
      console.warn(`❌ Invalid user token attempted`);
      this.sendError(ws, ERROR_CODES.INVALID_USER_TOKEN, 'Invalid user token');
      return ws.close();
    }

    if (userResult.error) {
      this.sendError(ws, ERROR_CODES.USER_SUSPENDED, 'User account is suspended');
      return ws.close();
    }

    // === Create Session ===
    const hub = hubResult.hub;
    const user = userResult.user;

    const session = await sessionService.createSession({
      userId: user.id,
      hubId: hub.id,
      wsClientId: client.id,
      gameInfo
    });

    // Increment hub connection count
    await hubService.incrementConnections(hub.id);

    // Update client metadata
    client.type = 'roblox';
    client.userId = user.id;
    client.hubId = hub.id;
    client.sessionId = session.id;
    client.authenticated = true;
    this.clients.set(ws, client);

    // Start heartbeat monitoring (Dead Man's Switch)
    this.startHeartbeatMonitor(client.id, session.id, user.id);

    console.log(`✓ SDK connected: user=${user.username}, hub=${hub.name}, game=${gameInfo?.name || 'Unknown'}`);

    this.send(ws, {
      type: 'authenticated',
      sessionId: session.id,
      user: {
        username: user.username,
        hasDevices: user.devices.length > 0
      },
      hub: {
        name: hub.name
      },
      message: 'Connection established'
    });

    // Notify mobile apps
    this.notifyMobileApps(user.id, {
      type: 'session_started',
      sessionId: session.id,
      gameName: gameInfo?.name || 'Unknown Game',
      hubName: hub.name,
      timestamp: Date.now()
    });
  }

  // ============================================================================
  // HEARTBEAT (Dead Man's Switch)
  // ============================================================================

  startHeartbeatMonitor(clientId, sessionId, userId) {
    // Clear any existing timer
    this.stopHeartbeatMonitor(clientId);

    const timeoutMs = config.deadman?.heartbeatTimeout || 30000;

    const timer = setTimeout(async () => {
      console.log(`⚠️ TIMEOUT: Session ${sessionId} - no heartbeat`);
      await this.triggerDeadManSwitch(clientId, sessionId, userId);
    }, timeoutMs);

    this.heartbeatTimers.set(clientId, { timer, sessionId, userId });
  }

  stopHeartbeatMonitor(clientId) {
    const existing = this.heartbeatTimers.get(clientId);
    if (existing) {
      clearTimeout(existing.timer);
      this.heartbeatTimers.delete(clientId);
    }
  }

  resetHeartbeatMonitor(clientId) {
    const existing = this.heartbeatTimers.get(clientId);
    if (existing) {
      this.startHeartbeatMonitor(clientId, existing.sessionId, existing.userId);
      return true;
    }
    return false;
  }

  async triggerDeadManSwitch(clientId, sessionId, userId) {
    console.log(`🚨 DEAD MAN'S SWITCH TRIGGERED for session ${sessionId}`);

    // Handle in session service (sends alerts)
    const result = await sessionService.handleTimeout(clientId);

    if (result) {
      // Close the WebSocket if still open
      for (const [ws, client] of this.clients.entries()) {
        if (client.id === clientId) {
          ws.close();
          break;
        }
      }
    }
  }

  async handleHeartbeat(ws, client) {
    if (!client.authenticated || client.type !== 'roblox') {
      return;
    }

    // Reset dead man's switch
    const reset = this.resetHeartbeatMonitor(client.id);

    // Update session heartbeat in DB
    if (client.sessionId) {
      await sessionService.updateHeartbeat(client.id);
    }

    this.send(ws, {
      type: 'pong',
      timestamp: Date.now()
    });
  }

  // ============================================================================
  // SDK MESSAGES (from Roblox scripts)
  // ============================================================================

  async handleLog(ws, client, message) {
    if (!this.requireAuth(ws, client, 'roblox')) return;

    if (!this.checkRateLimit(client.id, 'log')) {
      this.sendError(ws, ERROR_CODES.RATE_LIMITED, 'Log messages limited to 30 per minute');
      return;
    }

    const { message: logMessage, level = 'info' } = message;

    // Forward to mobile apps via WebSocket
    this.notifyMobileApps(client.userId, {
      type: 'log',
      sessionId: client.sessionId,
      message: logMessage,
      level,
      timestamp: Date.now()
    });

    // Store in Redis for history
    await redisService.client?.lPush(
      `logs:${client.userId}`,
      JSON.stringify({
        sessionId: client.sessionId,
        message: logMessage,
        level,
        timestamp: Date.now()
      })
    );
    await redisService.client?.lTrim(`logs:${client.userId}`, 0, 199);
  }

  async handleStatus(ws, client, message) {
    if (!this.requireAuth(ws, client, 'roblox')) return;

    if (!this.checkRateLimit(client.id, 'status')) {
      this.sendError(ws, ERROR_CODES.RATE_LIMITED, 'Status updates limited to 6 per minute');
      return;
    }

    const { status, data } = message;

    // Update session status
    await sessionService.updateStatus(client.id, status);

    // Forward to mobile apps
    this.notifyMobileApps(client.userId, {
      type: 'status_update',
      sessionId: client.sessionId,
      status,
      data,
      timestamp: Date.now()
    });
  }

  async handleNotify(ws, client, message) {
    if (!this.requireAuth(ws, client, 'roblox')) return;

    if (!this.checkRateLimit(client.id, 'notify')) {
      this.sendError(ws, ERROR_CODES.RATE_LIMITED, 'Notifications limited to 5 per minute');
      return;
    }

    const { title, message: body } = message;

    if (!title || !body) {
      this.sendError(ws, ERROR_CODES.INVALID_PARAMS, 'Title and message are required');
      return;
    }

    // Forward to mobile via WebSocket
    this.notifyMobileApps(client.userId, {
      type: 'notification',
      sessionId: client.sessionId,
      title,
      body,
      timestamp: Date.now()
    });

    // Send FCM push notification
    await deviceService.sendPushToUser(client.userId, {
      title,
      body,
      data: { sessionId: client.sessionId, type: 'notification' }
    });
  }

  async handleAlert(ws, client, message) {
    if (!this.requireAuth(ws, client, 'roblox')) return;

    if (!this.checkRateLimit(client.id, 'alert')) {
      this.sendError(ws, ERROR_CODES.RATE_LIMITED, 'Alerts limited to 5 per minute');
      return;
    }

    const { reason, title } = message;
    const alertReason = reason || 'Critical alert from script';

    // Get session info
    const session = await sessionService.getSessionById(client.sessionId);

    const alertData = {
      sessionId: client.sessionId,
      gameName: session?.gameName || 'Unknown Game',
      hubName: session?.hub?.name || 'Unknown',
      reason: alertReason,
      title: title || '🚨 CRITICAL ALERT',
      lastStatus: session?.currentStatus
    };

    // Forward to mobile via WebSocket
    this.notifyMobileApps(client.userId, {
      type: 'critical_alert',
      ...alertData,
      timestamp: Date.now()
    });

    // Send FCM critical alert
    await deviceService.sendCriticalAlertToUser(client.userId, alertData);

    console.log(`🚨 Alert sent: ${alertReason}`);
  }

  async handleDisconnect(ws, client, message) {
    if (!this.requireAuth(ws, client, 'roblox')) return;

    const reason = message.reason || 'Script disconnected';

    // Stop monitoring
    this.stopHeartbeatMonitor(client.id);

    // Update session
    await sessionService.disconnectSession(client.id, 'MANUAL', reason);

    // Notify mobile
    this.notifyMobileApps(client.userId, {
      type: 'session_ended',
      sessionId: client.sessionId,
      reason,
      timestamp: Date.now()
    });

    this.send(ws, {
      type: 'disconnected',
      message: 'Disconnect acknowledged'
    });

    ws.close();
  }

  // ============================================================================
  // MOBILE APP MESSAGES
  // ============================================================================

  /**
   * Handle mobile app authentication with JWT token
   */
  async handleMobileAuthenticate(ws, client, message) {
    const { token, deviceId } = message;

    if (!token) {
      this.sendError(ws, ERROR_CODES.NOT_AUTHENTICATED, 'Token is required');
      return;
    }

    try {
      // Verify JWT token
      const jwt = await import('jsonwebtoken');
      const decoded = jwt.default.verify(token, config.jwt.secret);
      
      if (!decoded || !decoded.userId) {
        this.sendError(ws, ERROR_CODES.NOT_AUTHENTICATED, 'Invalid token');
        return;
      }

      // Get user
      const user = await userService.getUserById(decoded.userId);
      if (!user) {
        this.sendError(ws, ERROR_CODES.INVALID_USER_TOKEN, 'User not found');
        return;
      }

      if (user.status === 'SUSPENDED') {
        this.sendError(ws, ERROR_CODES.USER_SUSPENDED, 'Account suspended');
        return;
      }

      // Update client metadata
      client.type = 'mobile';
      client.userId = user.id;
      client.deviceId = deviceId;
      client.authenticated = true;
      this.clients.set(ws, client);

      // Get active sessions
      const sessions = await sessionService.getActiveSessionsByUser(user.id);

      console.log(`📱 Mobile authenticated: ${user.username} (${sessions.length} active sessions)`);

      this.send(ws, {
        type: 'authenticated',
        user: {
          id: user.id,
          username: user.username
        },
        sessions: sessions.map(s => ({
          id: s.id,
          gameName: s.gameName,
          hubName: s.hub?.name,
          status: 'ACTIVE',
          currentStatus: s.currentStatus,
          connectedAt: s.connectedAt,
          lastHeartbeat: s.lastHeartbeatAt
        }))
      });
    } catch (error) {
      console.error('Mobile auth error:', error.message);
      this.sendError(ws, ERROR_CODES.NOT_AUTHENTICATED, 'Authentication failed');
    }
  }

  async handleMobileRegister(ws, client, message) {
    const { userId, userToken, fcmToken, deviceName, platform, appVersion } = message;

    // Can authenticate via userId (legacy) or userToken (new)
    let user;
    
    if (userToken) {
      const result = await userService.validateUserToken(userToken);
      if (!result || result.error) {
        this.sendError(ws, ERROR_CODES.INVALID_USER_TOKEN, 'Invalid user token');
        return;
      }
      user = result.user;
    } else if (userId) {
      // Legacy: direct userId (for mobile app that already has session)
      user = await userService.getUserById(userId);
      if (!user) {
        this.sendError(ws, ERROR_CODES.INVALID_USER_TOKEN, 'User not found');
        return;
      }
    } else {
      this.sendError(ws, ERROR_CODES.INVALID_PARAMS, 'userToken or userId required');
      return;
    }

    // Update client
    client.type = 'mobile';
    client.userId = user.id;
    client.authenticated = true;
    this.clients.set(ws, client);

    // Register device for FCM if token provided
    if (fcmToken && fcmToken !== 'EXPO_GO_TESTING') {
      await deviceService.registerDevice(user.id, {
        fcmToken,
        name: deviceName,
        platform,
        appVersion
      });
    }

    // Get active sessions
    const sessions = await sessionService.getActiveSessionsByUser(user.id);

    console.log(`📱 Mobile registered: ${user.username} (${sessions.length} active sessions)`);

    this.send(ws, {
      type: 'registered',
      user: {
        id: user.id,
        username: user.username
      },
      sessions: sessions.map(s => ({
        id: s.id,
        gameName: s.gameName,
        hubName: s.hub?.name,
        status: 'ACTIVE',
        currentStatus: s.currentStatus,
        connectedAt: s.connectedAt,
        lastHeartbeat: s.lastHeartbeatAt
      }))
    });
  }

  async handleCommand(ws, client, message) {
    if (!this.requireAuth(ws, client, 'mobile')) return;

    const { sessionId, command, data } = message;

    if (!sessionId || !command) {
      this.sendError(ws, ERROR_CODES.INVALID_PARAMS, 'sessionId and command are required');
      return;
    }

    // Find target Roblox client
    for (const [targetWs, targetClient] of this.clients.entries()) {
      if (targetClient.sessionId === sessionId && targetClient.type === 'roblox') {
        this.send(targetWs, {
          type: 'command',
          command,
          data
        });

        this.send(ws, {
          type: 'command_sent',
          sessionId
        });
        return;
      }
    }

    this.sendError(ws, ERROR_CODES.SESSION_NOT_FOUND, 'Session not connected');
  }

  // ============================================================================
  // CONNECTION LIFECYCLE
  // ============================================================================

  async handleClose(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    if (config.nodeEnv === 'development') {
      console.log(`🔌 Disconnected: ${client.id.substring(0, 8)} (${client.type || 'unknown'})`);
    }

    if (client.type === 'roblox' && client.authenticated) {
      // Don't stop monitor immediately - let Dead Man's Switch trigger
      // The timeout will fire if this was an abrupt disconnect

      // Notify mobile apps
      this.notifyMobileApps(client.userId, {
        type: 'session_connection_lost',
        sessionId: client.sessionId,
        timestamp: Date.now()
      });
    }

    this.clients.delete(ws);
  }

  handleError(ws, error) {
    const client = this.clients.get(ws);
    console.error(`WebSocket error [${client?.id?.substring(0, 8)}]:`, error.message);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  requireAuth(ws, client, expectedType) {
    if (!client.authenticated) {
      this.sendError(ws, ERROR_CODES.NOT_AUTHENTICATED, 'Not authenticated');
      return false;
    }
    if (expectedType && client.type !== expectedType) {
      this.sendError(ws, ERROR_CODES.INVALID_MESSAGE, `This command is for ${expectedType} clients only`);
      return false;
    }
    return true;
  }

  send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  sendError(ws, code, message) {
    this.send(ws, {
      type: 'error',
      code,
      message
    });
  }

  notifyMobileApps(userId, data) {
    let count = 0;
    for (const [ws, client] of this.clients.entries()) {
      if (client.type === 'mobile' && client.userId === userId && client.authenticated) {
        this.send(ws, data);
        count++;
      }
    }
    if (count > 0 && config.nodeEnv === 'development') {
      console.log(`📱 Notified ${count} mobile client(s) for user ${userId}`);
    }
  }

  getStats() {
    const stats = {
      total: this.clients.size,
      roblox: 0,
      mobile: 0,
      authenticated: 0
    };

    for (const client of this.clients.values()) {
      if (client.type === 'roblox') stats.roblox++;
      if (client.type === 'mobile') stats.mobile++;
      if (client.authenticated) stats.authenticated++;
    }

    return stats;
  }

  /**
   * Graceful shutdown - disconnect all clients
   */
  async shutdown() {
    console.log('🛑 Shutting down WebSocket server...');

    // Stop all heartbeat timers
    for (const [clientId, { timer }] of this.heartbeatTimers.entries()) {
      clearTimeout(timer);
    }
    this.heartbeatTimers.clear();

    // Close all connections
    for (const [ws, client] of this.clients.entries()) {
      if (client.type === 'roblox' && client.sessionId) {
        await sessionService.disconnectSession(client.id, 'SERVER_SHUTDOWN', 'Server maintenance');
      }
      ws.close(1001, 'Server shutdown');
    }

    this.clients.clear();
  }
}

export default new WebSocketServiceV2();
