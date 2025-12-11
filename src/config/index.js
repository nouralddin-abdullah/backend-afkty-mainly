import dotenv from 'dotenv';

dotenv.config();

export default {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || undefined
  },
  
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-secret-key'
  },
  
  deadman: {
    heartbeatTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT) || 30000,
    reconnectGracePeriod: parseInt(process.env.RECONNECT_GRACE_PERIOD) || 5000
  }
};
