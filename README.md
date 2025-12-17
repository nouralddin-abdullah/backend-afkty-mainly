# Afkty Backend - Dead Man's Switch Server

The central brain of the Afkty Always-On Alert System. Monitors Roblox game sessions and triggers critical alerts when disconnections occur.

## Architecture

This backend implements a **Dead Man's Switch** pattern:
- Monitors WebSocket connections from Roblox scripts
- Detects crashes, kicks, and internet failures
- Instantly alerts mobile devices via Firebase Cloud Messaging
- Maintains session state in Redis for real-time performance

## Features

- **WebSocket Server**: Real-time bidirectional communication
- **Dead Man's Switch**: Automatic failure detection
- **Redis Session Store**: Fast session state management
- **FCM Integration**: Push notifications to mobile devices
- **Authentication System**: Secure key-based linking
- **Auto-Reconnect Handling**: Grace period for temporary disconnects

## Quick Start

### Prerequisites

- Node.js 18+
- Redis server
- Firebase project with Cloud Messaging enabled

### Installation

```bash
cd backend
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Configure your Redis connection
3. Add Firebase Admin SDK credentials
4. Set a strong JWT secret

### Running

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### HTTP API

- `POST /api/v1/auth/register` - Create user account
- `POST /api/v1/auth/login` - Login and get JWT token
- `POST /api/v1/connections/generate` - Generate connection key
- `GET /api/v1/sdk` - Load Roblox SDK script

### WebSocket API

Connect to `ws://localhost:3000/ws`

#### Message Types

**From Roblox Script:**
```json
{
  "type": "connect",
  "connectionKey": "afk-992-884",
  "gameInfo": {
    "name": "Blox Fruits",
    "jobId": "abc123"
  }
}
```

**From Mobile App:**
```json
{
  "type": "register_device",
  "userId": "user_123",
  "fcmToken": "fcm_device_token"
}
```

## Project Structure

```
backend/
├── src/
│   ├── index.js              # Entry point
│   ├── config/               # Configuration
│   ├── services/             # Business logic
│   │   ├── websocket.js      # WebSocket handler
│   │   ├── deadman.js        # Dead Man's Switch logic
│   │   ├── redis.js          # Redis client
│   │   └── fcm.js            # Firebase messaging
│   ├── routes/               # HTTP routes
│   └── middleware/           # Express middleware
├── .env                      # Environment variables
└── package.json
```

## Security Considerations

- All passwords hashed with bcrypt
- JWT tokens for authentication
- Connection keys are single-use and time-limited
- Firebase Admin SDK for secure push notifications
- Helmet.js for HTTP security headers

## Documentation

Full documentation is available at [afkty-docs.vercel.app](https://afkty-docs.vercel.app) or in the `/docs` folder.

To run documentation locally:
```bash
cd docs
npm install
npm start
```

## Support

Join our Discord community for help and updates:

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/CX5fMuesqp)

## License

MIT
