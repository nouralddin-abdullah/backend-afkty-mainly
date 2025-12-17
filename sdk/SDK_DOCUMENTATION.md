# AFKTY SDK v3.0

Get alerts on your phone when your Roblox script crashes or gets kicked.

---

## Setup

```lua
local AFKTY = loadstring(game:HttpGet("https://api.afkty.com/sdk/v3"))()

AFKTY:Init({
    hubKey = "hub_live_xxx",  -- From the script developer
    userToken = "ABC123"      -- Your 6-character key from AFKTY app
})
```

> **Note:** Both `hubKey` and `userToken` are required. The hubKey comes from the script developer, and your userToken is found in the AFKTY mobile app under "Get My Key".

---

## Methods

### Set Status
```lua
AFKTY:SetStatus("Farming Zone 1")
```

### Send Log
```lua
AFKTY:Log("Collected 50 coins")
AFKTY:Log("Low health!", "warn")
AFKTY:Log("Error occurred", "error")
```

### Send Notification
```lua
AFKTY:Notify("Rare Drop!", "You found a Legendary Sword")
```

### Send Critical Alert
```lua
AFKTY:Alert("Kicked from game!")
```

### Disconnect
```lua
AFKTY:Disconnect("Script finished")
```

### Check Connection Status
```lua
-- Check if connected
if AFKTY:IsConnected() then
    print("Connected to AFKTY!")
else
    print("Not connected")
end

-- Get session info (after connected)
local info = AFKTY:GetSessionInfo()
print("Session ID:", info.sessionId)
print("Hub:", info.hubName)
print("Username:", info.username)
```

---

## Connection & Crash Detection

### How It Works

1. **Connect** - SDK connects to AFKTY server with your keys
2. **Heartbeat** - SDK sends a heartbeat every 10 seconds
3. **Crash Detection** - If heartbeat stops (game crash/kick), server triggers alert
4. **Alert** - Your phone receives notification with loud alarm

### Auto-Reconnect

The SDK automatically reconnects if connection drops:
- Starts with 3 second delay
- Increases up to 60 seconds between retries
- Retries up to 20 times before giving up

```lua
-- Disable auto-reconnect if needed
AFKTY:Init({
    hubKey = "hub_live_xxx",
    userToken = "ABC123",
    autoReconnect = false  -- Default is true
})
```

---

## Events

```lua
AFKTY.OnConnected:Connect(function()
    print("Connected!")
end)

AFKTY.OnDisconnected:Connect(function()
    print("Disconnected!")
end)

AFKTY.OnCommand:Connect(function(data)
    if data.command == "stop" then
        AFKTY:Disconnect("Stopped by user")
    end
end)

AFKTY.OnError:Connect(function(data)
    warn("Error:", data.code, data.message)
end)
```

---

## For Hub Developers

### Apply for a Hub Key

```
POST https://api.afkty.com/api/v1/hubs/apply

{
    "name": "My Script Hub",
    "ownerEmail": "dev@example.com",
    "discordUrl": "https://discord.gg/xxx"
}
```

### Embed in Your Script

```lua
local HUB_KEY = "hub_live_xxx"  -- Your hub key

local AFKTY = loadstring(game:HttpGet("https://api.afkty.com/sdk/v3"))()

AFKTY:Init({
    hubKey = HUB_KEY,
    userToken = Settings.AfktyKey  -- User enters their key
})
```

---

## Rate Limits

| Type | Limit |
|------|-------|
| Status | 6/min |
| Logs | 30/min |
| Notifications | 5/min |
| Alerts | 5/min |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `INVALID_HUB_KEY` | Hub key is wrong or doesn't exist |
| `HUB_NOT_APPROVED` | Hub is pending approval |
| `HUB_SUSPENDED` | Hub has been suspended |
| `INVALID_USER_TOKEN` | User key is wrong - check your 6-character key |
| `USER_SUSPENDED` | User account has been suspended |
| `WEBSOCKET_NOT_SUPPORTED` | Your executor doesn't support WebSocket |
| `CONNECTION_FAILED` | Could not connect to server |
| `RATE_LIMITED` | Too many requests, slow down |

---

## Troubleshooting

### "Not connecting" or "No alerts"

1. **Check your executor supports WebSocket**
   ```lua
   -- The SDK will print which WebSocket method it's using
   -- Look for: "Using WebSocket: [method name]"
   ```

2. **Verify your keys are correct**
   - `hubKey` - Must start with `hub_live_` or `hub_test_`
   - `userToken` - Your 6-character key from the app (e.g., `ABC123`)

3. **Listen for errors**
   ```lua
   AFKTY.OnError:Connect(function(data)
       warn("AFKTY Error:", data.code, data.message)
   end)
   ```

4. **Check connection status**
   ```lua
   AFKTY.OnConnected:Connect(function()
       print("✓ AFKTY Connected!")
   end)
   
   AFKTY.OnDisconnected:Connect(function()
       warn("✗ AFKTY Disconnected!")
   end)
   ```

### "Connection drops frequently"

The SDK auto-reconnects, but if you're having issues:
- Check your internet connection
- Make sure the game isn't being rate-limited
- The script might be getting kicked by anti-cheat

### "No alarm sound on phone"

1. Open AFKTY app and check you're connected (green status)
2. Make sure notifications are enabled for AFKTY
3. Check your phone isn't on Do Not Disturb
4. Verify FCM token is registered (check app settings)

---

## Complete Example

```lua
-- Load SDK
local AFKTY = loadstring(game:HttpGet("https://api.afkty.com/sdk/v3"))()

-- Set up event handlers BEFORE Init
AFKTY.OnConnected:Connect(function()
    print("✓ AFKTY Connected! You will get alerts if this crashes.")
end)

AFKTY.OnError:Connect(function(data)
    warn("AFKTY Error:", data.code, "-", data.message)
end)

AFKTY.OnDisconnected:Connect(function()
    warn("AFKTY Disconnected - auto-reconnecting...")
end)

-- Initialize with your keys
local success = AFKTY:Init({
    hubKey = "hub_live_xxx",      -- From script developer
    userToken = "ABC123"          -- Your key from AFKTY app
})

if success then
    print("AFKTY initialized!")
    
    -- Update your status as you play
    AFKTY:SetStatus("Starting script...")
    
    -- Your script logic here
    while true do
        AFKTY:SetStatus("Farming - Level 50")
        task.wait(30)
    end
else
    warn("AFKTY failed to initialize")
end
```

---

## Support

Discord: https://discord.gg/CX5fMuesqp
Documentation: https://afkty-docs.vercel.app
