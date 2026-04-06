import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, GatewayIntentBits } from "discord.js";
import TelegramBot from "node-telegram-bot-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnvFile(path.join(__dirname, ".env"));

const config = {
  discordBotToken: process.env.DISCORD_BOT_TOKEN?.trim(),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
  telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim(),
  debugTelegramUpdates: process.env.DEBUG_TELEGRAM_UPDATES === "true",
  allowedChannelIds: parseList(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
};

validateConfig(config);

const telegramBot = createTelegramBot(config.telegramBotToken);
const discordClient = createDiscordClient();

registerTelegramHandlers(telegramBot, config);
registerDiscordHandlers(discordClient, telegramBot, config);
registerProcessHandlers(discordClient, telegramBot);

await startBots(discordClient, telegramBot, config);

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

function registerTelegramHandlers(bot, currentConfig) {
  bot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error?.message || error);
  });

  if (currentConfig.debugTelegramUpdates) {
    bot.on("message", (message) => {
      console.log("--- Telegram incoming message JSON ---");
      console.log(JSON.stringify(message, null, 2));
    });
  }
}

function registerDiscordHandlers(client, bot, currentConfig) {
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

      const telegramMessage = formatTelegramMessage(message);
      await sendTelegramText(bot, currentConfig.telegramChatId, telegramMessage);

      console.log(
        `Forwarded Discord message ${message.id} from ${message.author.tag} in #${message.channel.name}`,
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

function registerProcessHandlers(client, bot) {
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });

  process.on("SIGINT", async () => {
    await shutdown(client, bot, "SIGINT");
  });

  process.on("SIGTERM", async () => {
    await shutdown(client, bot, "SIGTERM");
  });
}

async function startBots(client, bot, currentConfig) {
  try {
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

async function shutdown(client, bot, signal) {
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

  process.exit(0);
}
