# Discord to Telegram Message Forwarder

A small Node.js bot that listens for Discord server messages and forwards them into a Telegram chat.

## What It Does

- Watches Discord guild messages
- Ignores bot messages and DMs
- Forwards message text, server, channel, and message link to Telegram
- Includes attachment URLs when present
- Optionally limits forwarding to specific Discord channels
- Optionally uses Redis to persist channel routing and forwarding state
- Can be run under PM2 for automatic restarts on Windows

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`
3. Fill in your real values in `.env`
4. Start the bot:

```bash
npm start
```

Helpful alternatives:

- `npm run start:live`
  Runs the bot directly and keeps logs in the terminal
- `npm run start:log`
  Runs the bot and also writes output to `bot.log`
- `npm run pm2:start`
  Starts the bot with PM2 so it can auto-restart if it crashes

## Environment Variables

Required:

- `DISCORD_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional:

- `DISCORD_ALLOWED_CHANNEL_IDS`
  Example: `1234567890,9876543210`
- `DEBUG_TELEGRAM_UPDATES`
  Set to `true` only when you need to inspect Telegram update payloads
- `REDIS_URL`
  Optional Redis connection string. When set, the bot can load per-channel Telegram chat mappings and persist forwarding metadata.

## Redis Support

Redis is optional in this project.

If `REDIS_URL` is not set:

- The bot forwards every allowed Discord message to `TELEGRAM_CHAT_ID`
- No Redis state is used

If `REDIS_URL` is set:

- The bot connects to Redis during startup
- The bot checks for a channel-specific target at `discord:channel:<DISCORD_CHANNEL_ID>:telegramChatId`
- If no Redis mapping exists, it falls back to `TELEGRAM_CHAT_ID`
- The bot stores channel metadata at `discord:channel:<DISCORD_CHANNEL_ID>:meta`
- The bot stores `bot:lastForwardedMessage`
- The bot increments `bot:stats:forwardedCount`

Example Redis key for routing a Discord channel to a different Telegram chat:

```text
discord:channel:123456789012345678:telegramChatId = -1009876543210
```

Example local Redis URL:

```text
REDIS_URL=redis://localhost:6379
```

## Running On Windows With PM2

1. Install project dependencies:

```bash
npm install
```

2. Start the bot with PM2:

```bash
npm run pm2:start
```

3. Check logs:

```bash
npm run pm2:logs
```

4. Restart after config changes:

```bash
npm run pm2:restart
```

5. Stop it:

```bash
npm run pm2:stop
```

To make PM2 restart managed apps after Windows reboot, run:

```bash
npx pm2 save
npx pm2 startup
```

PM2 may print a command for your machine that you need to run in an elevated PowerShell window.

## Notes

- `TELEGRAM_CHAT_ID` must be numeric
- Your Discord bot must have access to the channels you want to monitor
- Your Discord bot must have the `Message Content Intent` enabled in the Discord Developer Portal
- If your tokens were ever committed or pasted into source files, rotate them before running the bot again
- In PowerShell, use `npm.cmd` instead of `npm` if script execution is blocked
