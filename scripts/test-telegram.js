import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TelegramBot from "node-telegram-bot-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

loadEnvFile(path.join(projectRoot, ".env"));

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const telegramChatId = process.env.TELEGRAM_CHAT_ID?.trim();

validateConfig(telegramBotToken, telegramChatId);

const bot = new TelegramBot(telegramBotToken, { polling: false });

try {
  const botInfo = await bot.getMe();
  console.log(`Telegram bot authenticated as ${botInfo.username}`);

  const text = [
    "Telegram test message",
    `Time: ${new Date().toISOString()}`,
    "If you received this, the Telegram token and chat ID are working.",
  ].join("\n");

  const response = await bot.sendMessage(telegramChatId, text);
  console.log(`Test message sent successfully (message_id=${response.message_id})`);
} catch (error) {
  console.error("Telegram test failed:", error?.message || error);

  if (error?.response) {
    console.error(
      "Telegram API response:",
      error.response.statusCode,
      error.response.body,
    );
  }

  process.exit(1);
}

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

function validateConfig(token, chatId) {
  if (!token || token.includes("your_")) {
    console.error("TELEGRAM_BOT_TOKEN is missing in .env");
    process.exit(1);
  }

  if (!chatId || chatId.includes("your_")) {
    console.error("TELEGRAM_CHAT_ID is missing in .env");
    process.exit(1);
  }

  if (!/^-?\d+$/.test(chatId)) {
    console.error("TELEGRAM_CHAT_ID must be numeric.");
    process.exit(1);
  }
}
