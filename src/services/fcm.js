import admin from 'firebase-admin';
import config from '../config/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FCMService {
  constructor() {
    this.initialized = false;
  }

  initialize() {
    try {
      // Load service account from file
      const serviceAccountPath = join(__dirname, '../../afkty-aeaa1-firebase-adminsdk-fbsvc-b9c039931c.json');
      const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });

      this.initialized = true;
      console.log('✓ Firebase Admin SDK initialized');
    } catch (error) {
      console.error('Failed to initialize Firebase:', error.message);
      console.warn('⚠ Push notifications disabled');
    }
  }

  async sendCriticalAlert(fcmToken, data) {
    if (!this.initialized) {
      console.warn('FCM not initialized. Skipping notification.');
      return { success: false, reason: 'FCM not initialized' };
    }

    try {
      const title = '🚨 GAME DISCONNECTED';
      const body = data.reason || 'Your Roblox session has ended';
      
      const message = {
        token: fcmToken,
        // NO top-level notification - this prevents double notifications on web
        // Each platform handles its own notification display
        data: {
          type: 'critical_alert',
          sessionId: data.sessionId || '',
          reason: data.reason || 'unknown',
          gameName: data.gameName || 'Unknown Game',
          timestamp: Date.now().toString(),
          // Include title/body in data for service worker to use
          title: title,
          body: body
        },
        // Web Push configuration - handles web notification display
        webpush: {
          headers: {
            Urgency: 'high'
          },
          // Use data only for web - service worker will show notification
          fcmOptions: {
            link: '/dashboard'
          }
        },
        android: {
          priority: 'high',
          // Android shows notification from this config
          notification: {
            title: title,
            body: body,
            channelId: 'critical_alerts',
            priority: 'max',
            sound: 'alarm',
            visibility: 'public',
            defaultVibrateTimings: false,
            vibrateTimingsMillis: [0, 500, 200, 500, 200, 500]
          }
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert'
          },
          payload: {
            aps: {
              alert: {
                title: title,
                body: body
              },
              sound: {
                critical: 1,
                name: 'alarm.caf',
                volume: 1.0
              },
              interruptionLevel: 'critical'
            }
          }
        }
      };

      const response = await admin.messaging().send(message);
      console.log('✓ Critical alert sent:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('Failed to send FCM notification:', error);
      return { success: false, reason: error.message };
    }
  }

  async sendStatusUpdate(fcmToken, data) {
    if (!this.initialized) {
      return { success: false, reason: 'FCM not initialized' };
    }

    try {
      const message = {
        token: fcmToken,
        data: {
          type: 'status_update',
          status: data.status,
          gameName: data.gameName || '',
          timestamp: Date.now().toString()
        },
        android: {
          priority: 'normal'
        }
      };

      const response = await admin.messaging().send(message);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('Failed to send status update:', error);
      return { success: false, reason: error.message };
    }
  }

  async sendLogMessage(fcmToken, logData) {
    if (!this.initialized) {
      return { success: false, reason: 'FCM not initialized' };
    }

    try {
      const message = {
        token: fcmToken,
        data: {
          type: 'log',
          message: logData.message,
          level: logData.level || 'info',
          timestamp: Date.now().toString()
        }
      };

      await admin.messaging().send(message);
      return { success: true };
    } catch (error) {
      console.error('Failed to send log:', error);
      return { success: false, reason: error.message };
    }
  }

  async sendNotification(fcmToken, { title, body, data = {} }) {
    if (!this.initialized) {
      console.warn('FCM not initialized. Skipping notification.');
      return { success: false, reason: 'FCM not initialized' };
    }

    try {
      const message = {
        token: fcmToken,
        notification: {
          title: title || '✨ Afkty Notification',
          body: body || 'You have a new notification'
        },
        data: {
          type: 'notification',
          timestamp: Date.now().toString(),
          ...data
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default'
          }
        },
        apns: {
          headers: {
            'apns-priority': '5',
            'apns-push-type': 'alert'
          },
          payload: {
            aps: {
              alert: {
                title: title || '✨ Afkty Notification',
                body: body || 'You have a new notification'
              },
              sound: 'default'
            }
          }
        }
      };

      const response = await admin.messaging().send(message);
      console.log('✓ Notification sent:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('Failed to send notification:', error);
      return { success: false, reason: error.message };
    }
  }
}

export default new FCMService();
