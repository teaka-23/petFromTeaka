// Telegram-бот: мемы и котики с описанием породы.
// Логирует переписку в Supabase (таблица chat_messages).
//
// Запуск:
//   node bot.js        (токены читаются из .env или переменных окружения)
//
// Команды:
//   /start, /help       — справка
//   /meme               — случайный мем (никогда не повторяется)
//   /addmeme <описание> — подпись к фото: добавить мем в коллекцию (memes.json)
//   /cat                — случайный котик: фото + порода и факты (TheCatAPI)
//
// Мемы хранятся локально в memes.json; в базе остаётся только описание
// в логе переписки — по нему бот и следит, какие мемы уже показывал.

const MEMES_FILE = require("path").join(__dirname, "memes.json");

function loadMemes() {
  try {
    return JSON.parse(require("fs").readFileSync(MEMES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveMemes(memes) {
  require("fs").writeFileSync(MEMES_FILE, JSON.stringify(memes, null, 2));
}

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
  console.error("Укажите TELEGRAM_BOT_TOKEN в .env или окружении");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "https://uugrjjgrvcbhprqxktol.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
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

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function logMessage(username, message, senderType) {
  await sb("chat_messages", {
    method: "POST",
    body: JSON.stringify({ telegram_username: username, message, sender_type: senderType }),
  });
}

// Отправляет ответ пользователю и логирует его
async function reply(msg, text) {
  await tg("sendMessage", { chat_id: msg.chat.id, text });
  await logMessage(botUsername, text, "bot");
}

async function cmdHelp(msg) {
  await reply(
    msg,
    [
      "Я умею:",
      "• /meme — случайный мем (не повторяются)",
      "• /cat — случайный котик: порода и интересные факты",
      "• пришли фото с подписью /addmeme — добавить мем",
    ].join("\n")
  );
}

// --- Котики (TheCatAPI, https://thecatapi.com) ---

const CATAPI_KEY = process.env.CATAPI_KEY;
const BREEDS_FILE = require("path").join(__dirname, "cats_breeds.json");

function loadBreeds() {
  try {
    return JSON.parse(require("fs").readFileSync(BREEDS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveBreeds(breeds) {
  require("fs").writeFileSync(BREEDS_FILE, JSON.stringify(breeds, null, 2));
}

async function cmdCat(msg) {
  if (!CATAPI_KEY) {
    await reply(msg, "Котики пока спят 😴 Попроси владельца добавить CATAPI_KEY в .env (бесплатный ключ на thecatapi.com)");
    return;
  }

  let breeds = loadBreeds();
  if (!breeds.length) {
    const res = await fetch("https://api.thecatapi.com/v1/breeds", { headers: { "x-api-key": CATAPI_KEY } });
    if (!res.ok) throw new Error(`TheCatAPI breeds: ${res.status}`);
    breeds = await res.json();
    saveBreeds(breeds);
  }

  // Породы, которых ещё не показывали (по логу бота "[кот: id]")
  const rows = await (await sb("chat_messages?select=message&sender_type=eq.bot&limit=10000")).json();
  const shown = new Set(rows.map((r) => (r.message.match(/^\[кот: ([\w-]+)\]/) || [])[1]).filter(Boolean));
  const fresh = breeds.filter((b) => !shown.has(b.id));
  const pool = fresh.length ? fresh : breeds; // все породы показаны — повторяемся
  const breed = pool[Math.floor(Math.random() * pool.length)];

  const imgRes = await fetch(`https://api.thecatapi.com/v1/images/search?breed_ids=${breed.id}&limit=1`, {
    headers: { "x-api-key": CATAPI_KEY },
  });
  const [img] = await imgRes.json();

  const caption = [
    `🐱 ${breed.name}${breed.origin ? ` (${breed.origin})` : ""}`,
    breed.temperament ? `Характер: ${breed.temperament}.` : "",
    breed.description || "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);

  if (img?.url) {
    await tg("sendPhoto", { chat_id: msg.chat.id, photo: img.url, caption });
  } else {
    await reply(msg, caption);
  }
  await logMessage(botUsername, `[кот: ${breed.id}] ${breed.name}`, "bot");
}

async function cmdMeme(msg) {
  // Уже показанные мемы — по логу бота в базе: сообщения "[мем #N] ..."
  const rows = await (await sb("chat_messages?select=message&sender_type=eq.bot&limit=10000")).json();
  const shownIds = new Set(
    rows.map((r) => (r.message.match(/^\[мем #(\d+)\]/) || [])[1]).filter(Boolean).map(Number)
  );

  const fresh = loadMemes().filter((m) => !shownIds.has(m.id));
  if (!fresh.length) {
    await reply(msg, "Мемы закончились 😢 Пришли фото с подписью /addmeme — добавлю новые!");
    return;
  }

  const meme = fresh[Math.floor(Math.random() * fresh.length)];
  await tg("sendPhoto", { chat_id: msg.chat.id, photo: meme.file_id, caption: meme.description || undefined });
  await logMessage(botUsername, `[мем #${meme.id}] ${meme.description || "(без описания)"}`, "bot");
}

async function cmdAddMeme(msg, user) {
  const photo = msg.photo?.[msg.photo.length - 1];
  if (!photo) {
    await reply(msg, "Пришли фото (не файлом) с подписью /addmeme и парой слов описания");
    return;
  }
  const description = (msg.caption || "").replace(/^\/addmeme(@\w+)?\s*/i, "").trim();
  const memes = loadMemes();
  const id = (memes[memes.length - 1]?.id || 0) + 1;
  memes.push({ id, file_id: photo.file_id, description });
  saveMemes(memes);
  await reply(msg, `✅ Мем #${id} добавлен! Описание: ${description || "(нет)"}`);
}

async function handleMessage(msg) {
  const user = msg.from?.username || msg.from?.first_name || `id${msg.from?.id}`;
  const text = msg.text || msg.caption || "";
  const cmd = (text.split(" ")[0] || "").split("@")[0].toLowerCase();

  // Логируем сообщение пользователя
  await logMessage(user, text || "[фото]", "user");

  try {
    if (cmd === "/start" || cmd === "/help") return cmdHelp(msg);
    if (cmd === "/meme") return cmdMeme(msg);
    if (cmd === "/cat") return cmdCat(msg);
    if (cmd === "/addmeme") return cmdAddMeme(msg, user);

    if (!msg.text) {
      return reply(msg, "Я понимаю только команды. Список: /help");
    }

    await reply(msg, "Я понимаю только команды:\n/meme — мем\n/cat — котик\n/addmeme — добавить мем");
  } catch (e) {
    console.error("Ошибка обработки:", e.message);
    await tg("sendMessage", { chat_id: msg.chat.id, text: "Что-то пошло не так 😢 Попробуй ещё раз." });
  }
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
  await tg("setMyCommands", {
    commands: [
      { command: "meme", description: "Случайный мем (не повторяются)" },
      { command: "cat", description: "Случайный котик: порода и факты" },
      { command: "addmeme", description: "Подпись к фото — добавить мем" },
      { command: "help", description: "Справка" },
    ],
  });
  console.log(`Бот @${botUsername} запущен, ожидаю сообщения...`);
  await poll(0);
})();
