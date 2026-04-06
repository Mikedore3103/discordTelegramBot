# Discord to Telegram Message Forwarder

A small Node.js bot that listens for Discord server messages and forwards them into a Telegram chat.

## What It Does

- Watches Discord guild messages
- Ignores bot messages and DMs
- Forwards message text, server, channel, and message link to Telegram
- Includes attachment URLs when present
- Optionally limits forwarding to specific Discord channels

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

## Notes

- `TELEGRAM_CHAT_ID` must be numeric
- Your Discord bot must have access to the channels you want to monitor
- Your Discord bot must have the `Message Content Intent` enabled in the Discord Developer Portal
- If your tokens were ever committed or pasted into source files, rotate them before running the bot again
- In PowerShell, use `npm.cmd` instead of `npm` if script execution is blocked
