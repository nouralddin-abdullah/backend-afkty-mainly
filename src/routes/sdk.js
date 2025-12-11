import express from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

/**
 * GET /api/v1/sdk
 * Serve the Roblox Lua SDK script
 */
router.get('/', (req, res) => {
  try {
    const sdkPath = join(__dirname, '../../sdk/afkty.lua');
    const sdkContent = readFileSync(sdkPath, 'utf-8');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sdkContent);
  } catch (error) {
    console.error('Error serving SDK:', error);
    res.status(404).send('-- SDK not found');
  }
});

/**
 * GET /api/v1/sdk/docs
 * Serve SDK documentation
 */
router.get('/docs', (req, res) => {
  res.json({
    name: 'Afkty Roblox SDK',
    version: '1.0.0',
    description: 'Always-On Alert System for Roblox Scripts',
    installation: 'loadstring(game:HttpGet("https://api.afkty.com/v1/sdk"))()',
    usage: {
      initialization: {
        code: 'local Afkty = loadstring(game:HttpGet("https://api.afkty.com/v1/sdk"))()\nAfkty:Init({\n  connectionKey = "afk-123-456",\n  serverUrl = "ws://localhost:3000/ws"\n})',
        description: 'Initialize the SDK with your connection key'
      },
      status: {
        code: 'Afkty:SetStatus("Farming Bones")',
        description: 'Update current activity status'
      },
      logs: {
        code: 'Afkty:Log("Quest completed", "info")',
        description: 'Send log messages to mobile app'
      },
      disconnect: {
        code: 'Afkty:Disconnect("Manual stop")',
        description: 'Gracefully disconnect'
      }
    },
    events: {
      OnCommand: 'Fires when mobile app sends a command',
      OnConnected: 'Fires when connection is established',
      OnDisconnected: 'Fires when connection is lost'
    }
  });
});

export default router;
