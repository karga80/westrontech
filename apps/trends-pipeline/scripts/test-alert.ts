// Standalone bot test — Redis/Postgres gerektirmez
import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const userId = process.env.TELEGRAM_USER_ID;

if (!token) {
  console.error("HATA: TELEGRAM_BOT_TOKEN .env'de yok");
  process.exit(1);
}
if (!userId) {
  console.error("HATA: TELEGRAM_USER_ID .env'de yok");
  process.exit(1);
}

const chatId = parseInt(userId, 10);
if (isNaN(chatId)) {
  console.error("HATA: TELEGRAM_USER_ID sayı olmalı, şu an:", userId);
  process.exit(1);
}

console.log("Token:", token.slice(0, 10) + "...");
console.log("Chat ID:", chatId);
console.log("Bot'a bağlanılıyor...");

const bot = new TelegramBot(token, { polling: false });

try {
  const me = await bot.getMe();
  console.log(`Bot: @${me.username} (${me.first_name})`);

  await bot.sendMessage(
    chatId,
    "🟠 *TEST ALERT — ORANGE*\n📊 Score: 87 | Sources: 3\n🎯 `PEPE` (ethereum)\n💰 Liq: $420K | MCap: $3.8M\n📈 Vol 5m: $95K | Age: 45m\n🔗 Signals: x-trends, tiktok, dexscreener",
    { parse_mode: "Markdown" },
  );
  console.log("✅ Mesaj gönderildi! Telegram'ı kontrol et.");
} catch (err: unknown) {
  const e = err as { message?: string; response?: { body?: { error_code?: number; description?: string } } };
  const code = e.response?.body?.error_code;
  const desc = e.response?.body?.description ?? e.message;
  console.error(`HATA (${code}): ${desc}`);

  if (code === 403) console.error("→ Bota hiç mesaj atmadın. Telegram'da bota /start yaz (ama bot çalışmıyorsa olmaz — önce ana uygulamayı başlat).");
  if (code === 400) console.error("→ Chat ID yanlış. @userinfobot'a /start at ve doğru ID'yi .env'e yaz.");
  if (code === 401) console.error("→ Bot token geçersiz. BotFather'dan tekrar al.");
}

await bot.close();
