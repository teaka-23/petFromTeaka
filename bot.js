// Telegram-бот: считает количество символов в сообщении.
// Логирует сообщения пользователя и ответы бота в Supabase (таблица chat_messages).
//
// Запуск:
//   node bot.js        (токен читается из .env или переменной окружения)
//
// Токен бота получить у @BotFather в Telegram (команда /newbot).

// Загрузка .env без зависимостей
try {
  const envFile = require("fs").readFileSync(".env", "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* .env не обязателен */ }

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error("Укажите TELEGRAM_BOT_TOKEN: TELEGRAM_BOT_TOKEN=<токен> node bot.js");
  process.exit(1);
}

const SUPABASE_URL = "https://uugrjjgrvcbhprqxktol.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Z3JqamdydmNiaHBycXhrdG9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTc2NzYsImV4cCI6MjEwNzQ5MzY3Nn0.5inls15zzkGXnR0PO9ZhT7lFbpyyYL614UYRwUCKSxs";

const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

let botUsername = "bot";

async function tg(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${JSON.stringify(data)}`);
  return data.result;
}

async function logMessage(username, message) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ telegram_username: username, message }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert: ${res.status} ${body}`);
  }
}

async function handleMessage(msg) {
  const user = msg.from?.username || msg.from?.first_name || `id${msg.from?.id}`;

  if (!msg.text) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: "Пришлите текстовое сообщение, и я посчитаю символы." });
    return;
  }

  // 1. Логируем сообщение пользователя
  await logMessage(user, msg.text);

  // 2. Считаем символы (emoji = 1 символ)
  const count = [...msg.text].length;
  const reply = `В вашем сообщении ${count} символов`;

  // 3. Отправляем ответ и логируем его
  await tg("sendMessage", { chat_id: msg.chat.id, text: reply });
  await logMessage(botUsername, reply);
}

async function poll(offset = 0) {
  try {
    const updates = await tg("getUpdates", { offset, timeout: 30 });
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) {
        await handleMessage(u.message).catch((e) => console.error("Ошибка обработки сообщения:", e.message));
      }
    }
  } catch (e) {
    console.error("Ошибка polling:", e.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
  await poll(offset);
}

(async () => {
  const me = await tg("getMe", {});
  botUsername = me.username || "bot";
  console.log(`Бот @${botUsername} запущен, ожидаю сообщения...`);
  await poll(0);
})();
