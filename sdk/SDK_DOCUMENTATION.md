# Afkty SDK Documentation

Version 2.0.0

## Overview

The Afkty SDK connects Roblox scripts to the Afkty backend for monitoring and mobile alerts. When your script disconnects unexpectedly, the mobile app receives a notification.

## Requirements

- Executor with WebSocket support
- Valid connection key from the Afkty API
- Backend server running and accessible

### Supported Executors

| Executor | Status |
|----------|--------|
| Synapse X | Full Support |
| Script-Ware | Full Support |
| Fluxus | Full Support |
| Wave | Full Support |
| Seliware | Full Support |
| Krnl | Partial |

---

## Installation

```lua
local Afkty = loadstring(game:HttpGet("YOUR_SDK_URL"))()
```

---

## Quick Start

```lua
local Afkty = loadstring(game:HttpGet("YOUR_SDK_URL"))()

Afkty:Init({
    serverUrl = "ws://YOUR_SERVER:3000/ws",
    connectionKey = "afk-xxx-xxx"
})

Afkty:Log("Script started")
Afkty:SetStatus("Farming Zone 1")

Afkty.OnCommand:Connect(function(data)
    if data.command == "stop" then
        Afkty:Disconnect("Stopped by user")
    end
end)
```

---

## Configuration

### Afkty:Init(options)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| serverUrl | string | required | WebSocket server URL |
| connectionKey | string | required | Auth key from API |
| autoReconnect | boolean | true | Reconnect on disconnect |
| heartbeatInterval | number | 10 | Seconds between heartbeats |
| maxReconnectAttempts | number | 10 | Max retry attempts |
| debug | boolean | false | Enable console logging |
| queueOfflineMessages | boolean | true | Queue messages while disconnected |
| statusCooldown | number | 10 | Min seconds between status updates |

```lua
Afkty:Init({
    serverUrl = "ws://192.168.1.9:3000/ws",
    connectionKey = "afk-123-456",
    autoReconnect = true,
    heartbeatInterval = 10,
    debug = true
})
```

---

## Methods

### Afkty:Log(message, level)

Send a log message to the mobile app. Logs are batched automatically to reduce network traffic.

```lua
Afkty:Log("Collected 50 coins")
Afkty:Log("Low health", "warn")
Afkty:Log("Target not found", "error")
```

**Levels:** `info`, `warn`, `error`, `debug`

---

### Afkty:LogNow(message, level)

Send a log immediately without batching. Use for critical messages.

```lua
Afkty:LogNow("CRITICAL: Script crashed", "error")
```

---

### Afkty:SetStatus(status, data, force)

Update the status displayed on the mobile app. Includes built-in cooldown to prevent spam.

```lua
Afkty:SetStatus("Farming Zone 1")

Afkty:SetStatus("Collecting", { zone = "Desert", progress = 75 })

-- Force update (bypass cooldown)
Afkty:SetStatus("Boss Fight", nil, true)
```

---

### Afkty:Notify(title, message)

Send a push notification to the mobile app. Rate limited to 5 per minute.

```lua
Afkty:Notify("Rare Drop!", "You found a Legendary Sword")
```

---

### Afkty:Alert(reason, title)

Send a **CRITICAL ALERT** with alarm sound to the mobile app. Use for important events like kicks, bans, or crashes. Rate limited to 5 per minute (shared with Notify).

```lua
-- Basic alert
Afkty:Alert("Kicked from game - Teleport detected")

-- With custom title
Afkty:Alert("Anti-cheat triggered", "⚠️ BANNED")

-- Use in error handlers
pcall(function()
    -- risky code
end) or Afkty:Alert("Script crashed unexpectedly")
```

---

### Afkty:Disconnect(reason)

Disconnect from the server and stop auto-reconnect.

```lua
Afkty:Disconnect("Script completed")
```

---

### Afkty:IsConnected()

Check if connected and authenticated.

```lua
if Afkty:IsConnected() then
    Afkty:Log("Connection active")
end
```

---

### Afkty:GetSessionId()

Get the current session ID.

```lua
local sessionId = Afkty:GetSessionId()
```

---

### Afkty:GetInfo()

Get connection details.

```lua
local info = Afkty:GetInfo()
-- info.version, info.connected, info.authenticated, info.sessionId
```

---

## Events

### Afkty.OnConnected

Fired when authenticated with the server.

```lua
Afkty.OnConnected:Connect(function(data)
    print("Connected! Session:", data.sessionId)
end)
```

---

### Afkty.OnDisconnected

Fired when disconnected from the server.

```lua
Afkty.OnDisconnected:Connect(function(data)
    print("Disconnected. Will reconnect:", data.willReconnect)
end)
```

---

### Afkty.OnReconnecting

Fired before each reconnection attempt.

```lua
Afkty.OnReconnecting:Connect(function(data)
    print("Reconnecting:", data.attempt, "/", data.maxAttempts)
end)
```

---

### Afkty.OnCommand

Fired when a command is received from the mobile app.

```lua
Afkty.OnCommand:Connect(function(data)
    if data.command == "stop" then
        Afkty:Disconnect("Stopped by mobile")
    elseif data.command == "teleport" then
        -- Handle teleport
    end
end)
```

---

### Afkty.OnError

Fired when an error occurs.

```lua
Afkty.OnError:Connect(function(data)
    warn("Error:", data.code, data.message)
end)
```

**Error Codes:**
- `WEBSOCKET_NOT_SUPPORTED` - Executor lacks WebSocket
- `CONNECTION_FAILED` - Failed to connect
- `MAX_RECONNECT_ATTEMPTS` - Exceeded retry limit
- `SERVER_ERROR` - Server error

---

### Afkty.OnRateLimited

Fired when rate limited by the server.

```lua
Afkty.OnRateLimited:Connect(function(data)
    warn("Rate limited:", data.message)
end)
```

---

## Complete Example

```lua
local Afkty = loadstring(game:HttpGet("YOUR_SDK_URL"))()

-- Setup event handlers
Afkty.OnConnected:Connect(function(data)
    print("Connected to Afkty")
    Afkty:Log("Script initialized")
end)

Afkty.OnDisconnected:Connect(function(data)
    print("Disconnected from Afkty")
end)

Afkty.OnCommand:Connect(function(data)
    if data.command == "stop" then
        running = false
        Afkty:Disconnect("Stopped by user")
    end
end)

Afkty.OnRateLimited:Connect(function()
    warn("Slow down! Rate limited by server")
end)

-- Initialize
Afkty:Init({
    serverUrl = "ws://192.168.1.9:3000/ws",
    connectionKey = "afk-123-456",
    debug = true
})

-- Main loop
local running = true
local totalCoins = 0

while running and Afkty:IsConnected() do
    -- Your farming logic
    local coins = collectCoins()
    totalCoins = totalCoins + coins
    
    Afkty:Log("Collected " .. coins .. " coins")
    Afkty:SetStatus("Farming: " .. totalCoins .. " coins")
    
    if totalCoins >= 1000 then
        Afkty:Notify("Milestone!", "Collected 1000 coins")
        totalCoins = 0
    end
    
    task.wait(1)
end

Afkty:Disconnect("Script ended")
```

---

## Rate Limits

The backend enforces rate limits to prevent abuse:

| Method | Limit |
|--------|-------|
| Log | 30/minute |
| SetStatus | 6/minute |
| Notify | 5/minute |

The SDK includes built-in protections:
- **Log batching** - Logs are batched and sent together
- **Status cooldown** - Duplicate/frequent status updates are skipped
- **Message queuing** - Messages sent while offline are queued

---

## Automatic Features

- **Heartbeat** - Sent every 10 seconds to maintain connection
- **Auto-reconnect** - Reconnects with exponential backoff (max 30s)
- **Message queue** - Queues messages while disconnected (max 50)
- **Cleanup** - Disconnects when player leaves or game closes

---

## Troubleshooting

**Connection fails**
- Verify server URL is correct
- Check if backend is running
- Ensure network allows WebSocket

**Authentication fails**
- Connection keys are single-use
- Keys expire after 5 minutes
- Generate a new key from the API

**Rate limited**
- Reduce frequency of Log/SetStatus/Notify calls
- Use Log batching (automatic)
- Listen to OnRateLimited event

**Executor not supported**
- Update to latest executor version
- Some free executors lack WebSocket support
