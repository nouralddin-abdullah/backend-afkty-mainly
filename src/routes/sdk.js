import express from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

/**
 * GET /api/v1/sdk
 * Serve the Roblox Lua SDK script (v2 - simple connectionKey auth)
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
 * GET /api/v1/sdk/v3
 * Serve the Roblox Lua SDK v3 script (hubKey + userToken auth)
 */
router.get('/v3', (req, res) => {
  try {
    const sdkPath = join(__dirname, '../../sdk/afkty-v3.lua');
    const sdkContent = readFileSync(sdkPath, 'utf-8');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sdkContent);
  } catch (error) {
    console.error('Error serving SDK v3:', error);
    res.status(404).send('-- SDK v3 not found');
  }
});

/**
 * GET /api/v1/sdk/docs
 * Serve SDK documentation
 */
router.get('/docs', (req, res) => {
  res.json({
    name: 'Afkty Roblox SDK',
    version: '3.0.0',
    description: 'Always-On Alert System for Roblox Scripts',
    quickStart: {
      code: 'local AFKTY = loadstring(game:HttpGet("https://api.afkty.com/sdk/v3"))()\nAFKTY.SetUserKey("ABC123")  -- Your 6-character key from the app',
      description: 'The easiest way to get started'
    },
    usage: {
      simpleSetup: {
        code: 'AFKTY.SetUserKey("ABC123")',
        description: 'Just use your 6-character key from the AFKTY app'
      },
      fullSetup: {
        code: 'Afkty:Init({\n  hubKey = "hub_live_xxx",\n  userToken = "ABC123",\n  serverUrl = "wss://afkty.com/ws"\n})',
        description: 'Full initialization with hub key (for script developers)'
      },
      status: {
        code: 'AFKTY:SetStatus("Farming Zone 1")',
        description: 'Update current activity status'
      },
      logs: {
        code: 'AFKTY:Log("Quest completed", "info")',
        description: 'Send log messages to mobile app'
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
