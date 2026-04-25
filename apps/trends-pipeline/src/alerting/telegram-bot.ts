import TelegramBot from "node-telegram-bot-api";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import type { AlertTier } from "@/shared/types";

const log = createLogger("telegram-bot");

const RATE_LIMIT_MS = 30 * 60 * 1000; // 30 min per token

// Per-token last-sent timestamps for rate limiting
const lastSentMap = new Map<string, number>();

let bot: TelegramBot | null = null;

export interface UserPrefs {
  chatId: number;
  threshold: AlertTier;
  mutedUntil: Date | null;
}

// In-memory prefs (persisted to Postgres in Phase 8)
const userPrefs = new Map<string, UserPrefs>();

function getBot(): TelegramBot {
  if (!bot) {
    bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
    registerCommands(bot);
    log.info("Telegram bot started");
  }
  return bot;
}

function registerCommands(b: TelegramBot): void {
  b.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userPrefs.set(String(chatId), { chatId, threshold: "orange", mutedUntil: null });
    b.sendMessage(
      chatId,
      "🚀 *Westron Trends Bot*\n\nCommands:\n/watch <ticker> — add to watchlist\n/unwatch <name> — remove\n/list — show watchlist\n/threshold <yellow|orange|red> — set alert level\n/mute <1h|4h|24h> — temporary mute",
      { parse_mode: "Markdown" },
    );
    log.info({ chatId }, "New Telegram user registered");
  });

  b.onText(/\/threshold (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const tier = match?.[1]?.trim() as AlertTier;
    if (!["yellow", "orange", "red"].includes(tier)) {
      b.sendMessage(chatId, "Invalid threshold. Use: yellow, orange, or red");
      return;
    }
    const prefs = userPrefs.get(String(chatId));
    if (prefs) prefs.threshold = tier;
    else userPrefs.set(String(chatId), { chatId, threshold: tier, mutedUntil: null });
    b.sendMessage(chatId, `✅ Threshold set to ${tier.toUpperCase()}`);
  });

  b.onText(/\/mute (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const duration = match?.[1]?.trim();
    const durationMap: Record<string, number> = { "1h": 1, "4h": 4, "24h": 24 };
    const hours = durationMap[duration ?? ""] ?? 0;
    if (!hours) {
      b.sendMessage(chatId, "Usage: /mute 1h | 4h | 24h");
      return;
    }
    const mutedUntil = new Date(Date.now() + hours * 3_600_000);
    const prefs = userPrefs.get(String(chatId));
    if (prefs) prefs.mutedUntil = mutedUntil;
    b.sendMessage(chatId, `🔇 Muted for ${hours}h (until ${mutedUntil.toLocaleTimeString()})`);
  });

  b.onText(/\/list/, (msg) => {
    b.sendMessage(msg.chat.id, "📋 Watchlist feature coming soon");
  });
}

export function isRateLimited(identifier: string): boolean {
  const last = lastSentMap.get(identifier);
  return last !== undefined && Date.now() - last < RATE_LIMIT_MS;
}

export function markSent(identifier: string): void {
  lastSentMap.set(identifier, Date.now());
}

export async function sendAlert(message: string, tier: AlertTier): Promise<void> {
  if (env.DRY_RUN) {
    log.info({ tier, message: message.slice(0, 60) }, "[DRY_RUN] Telegram alert suppressed");
    return;
  }

  const b = getBot();
  for (const [, prefs] of userPrefs.entries()) {
    if (prefs.mutedUntil && prefs.mutedUntil > new Date()) continue;

    const tierOrder = { yellow: 1, orange: 2, red: 3 };
    if (tierOrder[tier] < tierOrder[prefs.threshold]) continue;

    try {
      await b.sendMessage(prefs.chatId, message, { parse_mode: "Markdown" });
    } catch (err) {
      log.warn({ chatId: prefs.chatId, err }, "Telegram send failed");
    }
  }
}

// Bootstrap with owner's chat ID
export function registerOwner(): void {
  const chatId = parseInt(env.TELEGRAM_USER_ID ?? "", 10);
  if (!isNaN(chatId)) {
    userPrefs.set(String(chatId), { chatId, threshold: "orange", mutedUntil: null });
    log.info({ chatId }, "Owner registered in Telegram bot");
  }
}
