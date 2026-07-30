import TelegramBot from "node-telegram-bot-api";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import { dexscreener } from "@/enrichment/dexscreener-client";
import { getRedis } from "@/storage/redis-client";
import type { AlertTier, FinalAlert } from "@/shared/types";

const log = createLogger("telegram-bot");

const RATE_LIMIT_MS = 30 * 60 * 1000;
const MAX_RECENT_ALERTS = 20;

const lastSentMap = new Map<string, number>();

let bot: TelegramBot | null = null;

export interface UserPrefs {
  chatId: number;
  threshold: AlertTier;
  mutedUntil: Date | null;
  paused: boolean;
  watchlist: Set<string>;
  snoozedTokens: Map<string, Date>;
}

const userPrefs = new Map<string, UserPrefs>();

interface RecentAlert {
  identifier: string;
  tier: AlertTier;
  score: number;
  alertType: string;
  ts: Date;
  message: string;
}

const recentAlerts: RecentAlert[] = [];

export function recordAlert(alert: FinalAlert, message: string): void {
  recentAlerts.unshift({
    identifier: alert.identifier,
    tier: alert.tier,
    score: alert.score,
    alertType: alert.alertType,
    ts: new Date(alert.emittedAt),
    message,
  });
  if (recentAlerts.length > MAX_RECENT_ALERTS) recentAlerts.pop();
}

function getOrCreatePrefs(chatId: number): UserPrefs {
  const key = String(chatId);
  if (!userPrefs.has(key)) {
    userPrefs.set(key, {
      chatId,
      threshold: "orange",
      mutedUntil: null,
      paused: false,
      watchlist: new Set(),
      snoozedTokens: new Map(),
    });
  }
  return userPrefs.get(key)!;
}

function getBot(): TelegramBot {
  if (!bot) {
    bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
    registerCommands(bot);
    log.info("Telegram bot started");
  }
  return bot;
}

function tierEmoji(tier: AlertTier): string {
  return tier === "red" ? "🔴" : tier === "orange" ? "🟠" : "🟡";
}

function formatPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(4)}`;
}

function formatChange(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function registerCommands(b: TelegramBot): void {
  // /start — register + help
  b.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    getOrCreatePrefs(chatId);
    b.sendMessage(
      chatId,
      `*Westron Trends Bot*\n\n` +
        `*Alert Commands*\n` +
        `/top [n] — top recent signals (default 5)\n` +
        `/check <ticker> — on-chain lookup\n` +
        `/status — pipeline health\n\n` +
        `*Filter Commands*\n` +
        `/threshold <yellow|orange|red> — set min tier\n` +
        `/watch <ticker> — add to watchlist\n` +
        `/unwatch <ticker> — remove from watchlist\n` +
        `/list — show watchlist & snoozes\n\n` +
        `*Mute Commands*\n` +
        `/mute <1h|4h|24h> — mute all alerts\n` +
        `/unmute — unmute early\n` +
        `/pause — pause until /resume\n` +
        `/resume — resume alerts\n` +
        `/snooze <ticker> <1h|4h|24h> — mute one token`,
      { parse_mode: "Markdown" },
    );
    log.info({ chatId }, "New Telegram user registered");
  });

  // /top [n]
  b.onText(/\/top(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const n = Math.min(parseInt(match?.[1] ?? "5", 10) || 5, 10);

    if (recentAlerts.length === 0) {
      b.sendMessage(chatId, "No recent signals yet.");
      return;
    }

    const lines = recentAlerts.slice(0, n).map((a, i) => {
      const age = Math.round((Date.now() - a.ts.getTime()) / 60_000);
      const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
      return `${i + 1}. ${tierEmoji(a.tier)} *${a.identifier}* — score ${a.score.toFixed(1)} (${ageStr})`;
    });

    b.sendMessage(chatId, `*Top ${n} Recent Signals*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
  });

  // /check <ticker or address>
  b.onText(/\/check (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match?.[1]?.trim() ?? "";

    if (!query) {
      b.sendMessage(chatId, "Usage: /check <ticker or contract address>");
      return;
    }

    await b.sendMessage(chatId, `🔍 Looking up *${query}*...`, { parse_mode: "Markdown" });

    try {
      const results = await dexscreener.searchTokens(query);
      const top = results[0];

      if (!top) {
        b.sendMessage(chatId, `No on-chain data found for *${query}*`, { parse_mode: "Markdown" });
        return;
      }

      const age = top.ageMs ? `${Math.round(top.ageMs / 3_600_000)}h` : "unknown";
      const text =
        `*${top.name} (${top.symbol})*\n` +
        `Chain: ${top.chain}\n` +
        `Price: ${formatPrice(top.priceUsd)}\n` +
        `5m / 1h / 24h: ${formatChange(top.priceChange5m)} / ${formatChange(top.priceChange1h)} / ${formatChange(top.priceChange24h)}\n` +
        `Liq: ${formatPrice(top.liquidityUsd)} · MCap: ${formatPrice(top.marketCap)}\n` +
        `Vol 24h: ${formatPrice(top.volume24h)} · Txns 5m: ${top.txCount5m}\n` +
        `Pair age: ${age}`;

      b.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
      log.warn({ query, err }, "Dexscreener check failed");
      b.sendMessage(chatId, "Dexscreener lookup failed. Try again.");
    }
  });

  // /status
  b.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const redis = getRedis();
      const [countBudget, callerBudget, rawPostsLen, velocityLen] = await Promise.all([
        redis.get("x:rate:getPostsCounts"),
        redis.get("x:rate:resolveHandle"),
        redis.xlen("x:raw-posts"),
        redis.xlen("x:velocity-spike").catch(() => 0),
      ]);

      const prefs = getOrCreatePrefs(chatId);
      const muteStatus = prefs.paused
        ? "paused (use /resume)"
        : prefs.mutedUntil && prefs.mutedUntil > new Date()
          ? `muted until ${prefs.mutedUntil.toLocaleTimeString()}`
          : `active (threshold: ${prefs.threshold.toUpperCase()})`;

      const text =
        `*Pipeline Status*\n\n` +
        `X count calls used (15m): ${countBudget ?? 0}/50\n` +
        `X handle lookups used (15m): ${callerBudget ?? 0}/50\n` +
        `Posts ingested: ${rawPostsLen}\n` +
        `Velocity spikes: ${velocityLen}\n` +
        `Recent signals: ${recentAlerts.length}\n\n` +
        `Your alerts: ${muteStatus}`;

      b.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
      log.warn({ err }, "Status command failed");
      b.sendMessage(chatId, "Could not fetch status — Redis unavailable.");
    }
  });

  // /threshold <tier>
  b.onText(/\/threshold (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const tier = match?.[1]?.trim() as AlertTier;
    if (!["yellow", "orange", "red"].includes(tier)) {
      b.sendMessage(chatId, "Usage: /threshold yellow | orange | red");
      return;
    }
    const prefs = getOrCreatePrefs(chatId);
    prefs.threshold = tier;
    b.sendMessage(chatId, `✅ Threshold set to *${tier.toUpperCase()}* ${tierEmoji(tier)}`, {
      parse_mode: "Markdown",
    });
  });

  // /watch <ticker>
  b.onText(/\/watch (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const ticker = match?.[1]?.trim().toUpperCase() ?? "";
    if (!ticker) {
      b.sendMessage(chatId, "Usage: /watch <ticker>");
      return;
    }
    const prefs = getOrCreatePrefs(chatId);
    prefs.watchlist.add(ticker);
    b.sendMessage(
      chatId,
      `👁 Added *${ticker}* to watchlist (${prefs.watchlist.size} items). You'll only get alerts for watched tokens.`,
      { parse_mode: "Markdown" },
    );
  });

  // /unwatch <ticker>
  b.onText(/\/unwatch (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const ticker = match?.[1]?.trim().toUpperCase() ?? "";
    const prefs = getOrCreatePrefs(chatId);
    prefs.watchlist.delete(ticker);
    const msg2 =
      prefs.watchlist.size === 0
        ? `Removed *${ticker}*. Watchlist empty — you'll receive all alerts.`
        : `Removed *${ticker}* (${prefs.watchlist.size} remaining).`;
    b.sendMessage(chatId, msg2, { parse_mode: "Markdown" });
  });

  // /list
  b.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    const prefs = getOrCreatePrefs(chatId);

    const watched =
      prefs.watchlist.size > 0 ? [...prefs.watchlist].join(", ") : "_none (receiving all alerts)_";

    const now = new Date();
    const snoozed = [...prefs.snoozedTokens.entries()]
      .filter(([, until]) => until > now)
      .map(([token, until]) => `• ${token} — until ${until.toLocaleTimeString()}`)
      .join("\n");

    const text =
      `*Watchlist:* ${watched}\n\n` +
      `*Active Snoozes:*\n${snoozed || "_none_"}`;

    b.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // /mute <1h|4h|24h>
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
    const prefs = getOrCreatePrefs(chatId);
    prefs.mutedUntil = mutedUntil;
    b.sendMessage(chatId, `🔇 Muted for ${hours}h (until ${mutedUntil.toLocaleTimeString()})`);
  });

  // /unmute
  b.onText(/\/unmute/, (msg) => {
    const prefs = getOrCreatePrefs(msg.chat.id);
    prefs.mutedUntil = null;
    b.sendMessage(msg.chat.id, "🔔 Unmuted — alerts active.");
  });

  // /pause
  b.onText(/\/pause/, (msg) => {
    const prefs = getOrCreatePrefs(msg.chat.id);
    prefs.paused = true;
    b.sendMessage(msg.chat.id, "⏸ Alerts paused. Send /resume to turn them back on.");
  });

  // /resume
  b.onText(/\/resume/, (msg) => {
    const prefs = getOrCreatePrefs(msg.chat.id);
    prefs.paused = false;
    prefs.mutedUntil = null;
    b.sendMessage(msg.chat.id, `▶️ Alerts resumed (threshold: ${prefs.threshold.toUpperCase()}).`);
  });

  // /snooze <ticker> <1h|4h|24h>
  b.onText(/\/snooze (\S+)\s+(\S+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const ticker = match?.[1]?.trim().toUpperCase() ?? "";
    const duration = match?.[2]?.trim();
    const durationMap: Record<string, number> = { "1h": 1, "4h": 4, "24h": 24 };
    const hours = durationMap[duration ?? ""] ?? 0;
    if (!ticker || !hours) {
      b.sendMessage(chatId, "Usage: /snooze <ticker> 1h | 4h | 24h");
      return;
    }
    const until = new Date(Date.now() + hours * 3_600_000);
    const prefs = getOrCreatePrefs(chatId);
    prefs.snoozedTokens.set(ticker, until);
    b.sendMessage(chatId, `💤 *${ticker}* snoozed for ${hours}h (until ${until.toLocaleTimeString()})`, {
      parse_mode: "Markdown",
    });
  });
}

export function isRateLimited(identifier: string): boolean {
  const last = lastSentMap.get(identifier);
  return last !== undefined && Date.now() - last < RATE_LIMIT_MS;
}

export function markSent(identifier: string): void {
  lastSentMap.set(identifier, Date.now());
}

export async function sendAlert(message: string, tier: AlertTier, alert?: FinalAlert): Promise<void> {
  if (alert) recordAlert(alert, message);

  if (env.DRY_RUN) {
    log.info({ tier, message: message.slice(0, 60) }, "[DRY_RUN] Telegram alert suppressed");
    return;
  }

  const b = getBot();
  const now = new Date();
  const tierOrder: Record<AlertTier, number> = { yellow: 1, orange: 2, red: 3 };

  for (const [, prefs] of userPrefs.entries()) {
    if (prefs.paused) continue;
    if (prefs.mutedUntil && prefs.mutedUntil > now) continue;
    if (tierOrder[tier] < tierOrder[prefs.threshold]) continue;

    // Per-token snooze check
    if (alert) {
      const snoozeKey = alert.identifier.toUpperCase();
      const snoozedUntil = prefs.snoozedTokens.get(snoozeKey);
      if (snoozedUntil && snoozedUntil > now) continue;
    }

    // Watchlist filter: if watchlist is set, only send matching tokens
    if (alert && prefs.watchlist.size > 0) {
      const id = alert.identifier.toUpperCase();
      if (!prefs.watchlist.has(id)) continue;
    }

    try {
      await b.sendMessage(prefs.chatId, message, { parse_mode: "Markdown" });
    } catch (err) {
      log.warn({ chatId: prefs.chatId, err }, "Telegram send failed");
    }
  }
}

export function startBot(): void {
  getBot();
}

export function registerOwner(): void {
  const chatId = parseInt(env.TELEGRAM_USER_ID ?? "", 10);
  if (!isNaN(chatId)) {
    getOrCreatePrefs(chatId);
    log.info({ chatId }, "Owner registered in Telegram bot");
  }
}
