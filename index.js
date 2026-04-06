import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, GatewayIntentBits } from "discord.js";
import TelegramBot from "node-telegram-bot-api";
import { createClient as createRedisClient } from "redis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnvFile(path.join(__dirname, ".env"));

const config = {
  discordBotToken: process.env.DISCORD_BOT_TOKEN?.trim(),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
  telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim(),
  debugTelegramUpdates: process.env.DEBUG_TELEGRAM_UPDATES === "true",
  allowedChannelIds: parseList(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
  redisUrl: process.env.REDIS_URL?.trim(),
};

validateConfig(config);

const telegramBot = createTelegramBot(config.telegramBotToken);
const discordClient = createDiscordClient();
const redisClient = createRedisConnection(config.redisUrl);

registerTelegramHandlers(telegramBot, config, redisClient);
registerDiscordHandlers(discordClient, telegramBot, config, redisClient);
registerProcessHandlers(discordClient, telegramBot, redisClient);

await startBots(discordClient, telegramBot, redisClient, config);

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isPlaceholder(value) {
  if (value === undefined || value === null) {
    return true;
  }

  const normalized = String(value).trim();

  return (
    normalized === "" ||
    normalized.includes("YOUR_") ||
    normalized.toUpperCase().includes("REPLACE_ME") ||
    normalized.toLowerCase().includes("your_") ||
    normalized.toLowerCase().includes("_here")
  );
}

function validateConfig(currentConfig) {
  const missingKeys = [];

  if (isPlaceholder(currentConfig.discordBotToken)) {
    missingKeys.push("DISCORD_BOT_TOKEN");
  }

  if (isPlaceholder(currentConfig.telegramBotToken)) {
    missingKeys.push("TELEGRAM_BOT_TOKEN");
  }

  if (isPlaceholder(currentConfig.telegramChatId)) {
    missingKeys.push("TELEGRAM_CHAT_ID");
  }

  if (missingKeys.length > 0) {
    console.error(
      "Missing required configuration in .env:",
      missingKeys.join(", "),
    );
    console.error("Copy .env.example to .env and fill in the real values.");
    process.exit(1);
  }

  if (!/^-?\d+$/.test(currentConfig.telegramChatId)) {
    console.error("TELEGRAM_CHAT_ID must be a numeric chat id.");
    process.exit(1);
  }
}

function createTelegramBot(token) {
  try {
    return new TelegramBot(token, { polling: true });
  } catch (error) {
    console.error("Failed to initialize Telegram bot:", error);
    process.exit(1);
  }
}

function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

function createRedisConnection(redisUrl) {
  if (isPlaceholder(redisUrl)) {
    return null;
  }

  const client = createRedisClient({ url: redisUrl });

  client.on("error", (error) => {
    console.error("Redis client error:", error?.message || error);
  });

  client.on("reconnecting", () => {
    console.warn("Redis client reconnecting...");
  });

  return client;
}

function registerTelegramHandlers(bot, currentConfig, redisClient) {
  bot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error?.message || error);
  });

  bot.onText(/^\/chatid(?:@\w+)?$/, async (message) => {
    await replySafe(
      bot,
      message.chat.id,
      `This Telegram chat id is \`${message.chat.id}\`.`,
      { parse_mode: "Markdown" },
    );
  });

  bot.onText(/^\/link(?:@\w+)?(?:\s+(.+))?$/, async (message, match) => {
    await handleLinkCommand(bot, redisClient, message, match?.[1]);
  });

  bot.onText(/^\/unlink(?:@\w+)?(?:\s+(.+))?$/, async (message, match) => {
    await handleUnlinkCommand(bot, redisClient, message, match?.[1]);
  });

  bot.onText(/^\/links(?:@\w+)?$/, async (message) => {
    await handleListLinksCommand(bot, redisClient, message, currentConfig.telegramChatId);
  });

  if (currentConfig.debugTelegramUpdates) {
    bot.on("message", (message) => {
      console.log("--- Telegram incoming message JSON ---");
      console.log(JSON.stringify(message, null, 2));
    });
  }
}

async function handleLinkCommand(bot, redisClient, message, argumentText) {
  if (!redisClient?.isOpen) {
    await replySafe(
      bot,
      message.chat.id,
      "Redis is not configured for this bot, so `/link` is unavailable right now.",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const [channelId, explicitChatId] = splitCommandArguments(argumentText);
  const targetChatId = explicitChatId || String(message.chat.id);

  if (!isDiscordId(channelId)) {
    await replySafe(
      bot,
      message.chat.id,
      "Usage: `/link <discord_channel_id>` or `/link <discord_channel_id> <telegram_chat_id>`",
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (!isTelegramChatId(targetChatId)) {
    await replySafe(
      bot,
      message.chat.id,
      "The Telegram chat id must be numeric.",
    );
    return;
  }

  try {
    await redisClient.set(`discord:channel:${channelId}:telegramChatId`, targetChatId);

    await replySafe(
      bot,
      message.chat.id,
      [
        "Link saved.",
        `Discord channel: \`${channelId}\``,
        `Telegram chat: \`${targetChatId}\``,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  } catch (error) {
    console.error("Failed to save Telegram link command:", error?.message || error);
    await replySafe(bot, message.chat.id, "I couldn't save that link in Redis.");
  }
}

async function handleUnlinkCommand(bot, redisClient, message, argumentText) {
  if (!redisClient?.isOpen) {
    await replySafe(
      bot,
      message.chat.id,
      "Redis is not configured for this bot, so `/unlink` is unavailable right now.",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const [channelId] = splitCommandArguments(argumentText);

  if (!isDiscordId(channelId)) {
    await replySafe(
      bot,
      message.chat.id,
      "Usage: `/unlink <discord_channel_id>`",
      { parse_mode: "Markdown" },
    );
    return;
  }

  try {
    const deletedCount = await redisClient.del(`discord:channel:${channelId}:telegramChatId`);

    if (deletedCount === 0) {
      await replySafe(
        bot,
        message.chat.id,
        `No link was found for Discord channel \`${channelId}\`.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    await replySafe(
      bot,
      message.chat.id,
      `Removed link for Discord channel \`${channelId}\`.`,
      { parse_mode: "Markdown" },
    );
  } catch (error) {
    console.error("Failed to remove Telegram link command:", error?.message || error);
    await replySafe(bot, message.chat.id, "I couldn't remove that link from Redis.");
  }
}

async function handleListLinksCommand(bot, redisClient, message, fallbackChatId) {
  if (!redisClient?.isOpen) {
    await replySafe(
      bot,
      message.chat.id,
      "Redis is not configured for this bot, so `/links` is unavailable right now.",
      { parse_mode: "Markdown" },
    );
    return;
  }

  try {
    const keys = await redisClient.keys("discord:channel:*:telegramChatId");

    if (keys.length === 0) {
      await replySafe(
        bot,
        message.chat.id,
        `No Redis links found. Default fallback chat is \`${fallbackChatId}\`.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    const lines = ["Current channel links:"];

    for (const key of keys.sort()) {
      const channelId = key.split(":")[2];
      const targetChatId = await redisClient.get(key);
      lines.push(`- \`${channelId}\` -> \`${targetChatId}\``);
    }

    await replySafe(bot, message.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Failed to list Redis links:", error?.message || error);
    await replySafe(bot, message.chat.id, "I couldn't load the current links from Redis.");
  }
}

function splitCommandArguments(argumentText) {
  if (!argumentText) {
    return [];
  }

  return argumentText
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isDiscordId(value) {
  return /^\d{16,20}$/.test(value || "");
}

function isTelegramChatId(value) {
  return /^-?\d+$/.test(value || "");
}

async function replySafe(bot, chatId, text, options = {}) {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (error) {
    console.error("Failed to send Telegram reply:", error?.message || error);
  }
}

function registerDiscordHandlers(client, bot, currentConfig, redisClient) {
  client.once("clientReady", () => {
    const guilds = client.guilds.cache.map((guild) => `${guild.id}:${guild.name}`);

    console.log(`Discord bot logged in as ${client.user.tag}`);
    console.log(`Watching ${client.guilds.cache.size} guild(s)`);

    if (guilds.length > 0) {
      console.log(`Guilds: ${guilds.join(", ")}`);
    }

    if (currentConfig.allowedChannelIds.length > 0) {
      console.log(
        `Forwarding restricted to channel ids: ${currentConfig.allowedChannelIds.join(", ")}`,
      );
    } else {
      console.log("Forwarding messages from all guild text channels the bot can read.");
    }

    if (redisClient) {
      console.log("Redis-backed channel mappings are enabled.");
    } else {
      console.log("Redis is not configured. Using TELEGRAM_CHAT_ID for all forwarded messages.");
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.author?.bot) {
        return;
      }

      if (!message.guild) {
        return;
      }

      if (
        currentConfig.allowedChannelIds.length > 0 &&
        !currentConfig.allowedChannelIds.includes(message.channel.id)
      ) {
        return;
      }

      const targetChatId = await resolveTelegramChatId(
        message.channel.id,
        currentConfig.telegramChatId,
        redisClient,
      );
      const telegramMessage = formatTelegramMessage(message);
      await sendTelegramText(bot, targetChatId, telegramMessage);
      await persistForwardingState(redisClient, message, targetChatId);

      console.log(
        `Forwarded Discord message ${message.id} from ${message.author.tag} in #${message.channel.name} to Telegram chat ${targetChatId}`,
      );
    } catch (error) {
      console.error("Error forwarding message to Telegram:", error?.message || error);

      if (error?.response) {
        console.error(
          "Telegram API response:",
          error.response.statusCode,
          error.response.body,
        );
      }
    }
  });

  client.on("error", (error) => {
    console.error("Discord client error:", error);
  });

  client.on("shardError", (error) => {
    console.error("Discord shard error:", error);
  });
}

async function resolveTelegramChatId(channelId, defaultChatId, redisClient) {
  if (!redisClient?.isOpen) {
    return defaultChatId;
  }

  try {
    const mappedChatId = await redisClient.get(`discord:channel:${channelId}:telegramChatId`);

    if (mappedChatId && /^-?\d+$/.test(mappedChatId)) {
      return mappedChatId;
    }
  } catch (error) {
    console.error("Failed to resolve Redis channel mapping:", error?.message || error);
  }

  return defaultChatId;
}

function formatTelegramMessage(message) {
  const content = message.content?.trim() || "[no text content]";
  const attachments = [...message.attachments.values()].map((attachment) => attachment.url);
  const attachmentBlock =
    attachments.length > 0 ? `\nAttachments:\n${attachments.join("\n")}` : "";

  return [
    "New Discord Message",
    `From: ${message.author.tag}`,
    `Server: ${message.guild.name}`,
    `Channel: #${message.channel.name}`,
    `Message Link: ${message.url}`,
    "",
    `Message: ${content}${attachmentBlock}`,
  ].join("\n");
}

async function sendTelegramText(bot, chatId, text) {
  const maxLength = 4000;

  if (text.length <= maxLength) {
    await bot.sendMessage(chatId, text);
    return;
  }

  let start = 0;

  while (start < text.length) {
    const chunk = text.slice(start, start + maxLength);
    await bot.sendMessage(chatId, chunk);
    start += maxLength;
  }
}

async function persistForwardingState(redisClient, message, targetChatId) {
  if (!redisClient?.isOpen) {
    return;
  }

  const now = new Date().toISOString();

  try {
    await Promise.all([
      redisClient.hSet(`discord:channel:${message.channel.id}:meta`, {
        channelId: message.channel.id,
        channelName: message.channel.name,
        guildId: message.guild.id,
        guildName: message.guild.name,
        lastMessageId: message.id,
        lastAuthorTag: message.author.tag,
        lastForwardedAt: now,
        targetChatId,
      }),
      redisClient.set(
        "bot:lastForwardedMessage",
        JSON.stringify({
          messageId: message.id,
          channelId: message.channel.id,
          guildId: message.guild.id,
          forwardedAt: now,
          targetChatId,
        }),
      ),
      redisClient.incr("bot:stats:forwardedCount"),
    ]);
  } catch (error) {
    console.error("Failed to persist forwarding state to Redis:", error?.message || error);
  }
}

function registerProcessHandlers(client, bot, redisClient) {
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });

  process.on("SIGINT", async () => {
    await shutdown(client, bot, redisClient, "SIGINT");
  });

  process.on("SIGTERM", async () => {
    await shutdown(client, bot, redisClient, "SIGTERM");
  });
}

async function startBots(client, bot, redisClient, currentConfig) {
  try {
    if (redisClient) {
      await redisClient.connect();
      console.log("Redis connection established.");
    }

    const telegramBotInfo = await bot.getMe();
    console.log(`Telegram bot logged in as ${telegramBotInfo.username}`);

    await client.login(currentConfig.discordBotToken);
    console.log("Discord to Telegram forwarder is running.");
  } catch (error) {
    console.error("Startup failed:", error?.message || error);
    process.exit(1);
  }
}

let isShuttingDown = false;

async function shutdown(client, bot, redisClient, signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down bots...`);

  try {
    await bot.stopPolling();
  } catch (error) {
    console.error("Failed to stop Telegram polling cleanly:", error?.message || error);
  }

  try {
    client.destroy();
  } catch (error) {
    console.error("Failed to destroy Discord client cleanly:", error?.message || error);
  }

  try {
    if (redisClient?.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    console.error("Failed to close Redis cleanly:", error?.message || error);
  }

  process.exit(0);
}
