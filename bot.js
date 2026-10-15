// Telegram-бот: мемы (imgflip) и котики с описанием породы (TheCatAPI).
// Логирование переписки в Supabase отключено (флаг LOG_TO_DB в коде).
//
// Запуск:
//   node bot.js        (токены читаются из .env или переменных окружения)
//
// Команды:
//   /start, /help — справка
//   /meme         — случайный мем
//   /cat          — случайный котик: фото + порода и факты
//
// Показанные мемы/породы бот вычисляет по собственному логу в базе
// (маркеры "[мем: id]" и "[кот: id]"), повторов не будет, пока не покажет все.

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

async function fetchMemes() {
  let memes = loadMemes();
  if (!memes.length) {
    const res = await fetch("https://api.imgflip.com/get_memes");
    const data = await res.json();
    if (!data.success) throw new Error("imgflip: не удалось получить мемы");
    memes = data.data.memes.map((m) => ({ id: m.id, name: m.name, url: m.url }));
    saveMemes(memes);
  }
  return memes;
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

// Логирование переписки в Supabase (пока не нужно — поставить true, чтобы включить)
const LOG_TO_DB = false;

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
  if (!LOG_TO_DB) return;
  await sb("chat_messages", {
    method: "POST",
    body: JSON.stringify({ telegram_username: username, message, sender_type: senderType }),
  });
}

// Показанные ботом маркеры вида "[мем: id]" / "[кот: id]" — из лога в базе
async function shownMarkers() {
  if (!LOG_TO_DB) return new Set(); // без лога в базе неоткуда узнать показанное
  const rows = await (await sb("chat_messages?select=message&sender_type=eq.bot&limit=10000")).json();
  return new Set(rows.map((r) => (r.message.match(/^\[(мем|кот): ([\w-]+)\]/) || []).slice(1).join(":")).filter(Boolean));
}

// Отправляет ответ пользователю и логирует его
async function reply(msg, text) {
  await tg("sendMessage", { chat_id: msg.chat.id, text });
  await logMessage(botUsername, text, "bot");
}

// Проверяет, что картинка реально загружается (HEAD, при отказе — GET)
async function imageLoads(url) {
  try {
    let res = await fetch(url, { method: "HEAD" });
    if (!res.ok || !(res.headers.get("content-type") || "").startsWith("image")) {
      res = await fetch(url);
      if (!res.ok || !(res.headers.get("content-type") || "").startsWith("image")) return false;
      await res.body.cancel();
    }
    return true;
  } catch {
    return false;
  }
}

// Отправляет фото, только если оно реально подгрузилось; иначе false
async function sendPhotoChecked(msg, url, caption) {
  if (!(await imageLoads(url))) return false;
  await tg("sendPhoto", { chat_id: msg.chat.id, photo: url, caption, parse_mode: "HTML" });
  return true;
}

async function cmdHelp(msg) {
  await reply(
    msg,
    [
      "Я умею:",
      "• /meme — случайный мем",
      "• /cat — случайный котик: порода и интересные факты",
    ].join("\n")
  );
}

async function cmdMeme(msg) {
  const memes = await fetchMemes();
  const shown = await shownMarkers();
  const fresh = memes.filter((m) => !shown.has(`мем:${m.id}`));
  const pool = fresh.length ? fresh : memes; // все показаны — начинаем повторять

  // До 3 попыток: берём кандидата и проверяем, что картинка реально грузится
  for (let attempt = 0; attempt < 3; attempt++) {
    const meme = pool[Math.floor(Math.random() * pool.length)];
    if (await sendPhotoChecked(msg, meme.url, meme.name)) {
      await logMessage(botUsername, `[мем: ${meme.id}] ${meme.name}`, "bot");
      return;
    }
  }
  await reply(msg, "Картинки мемов сейчас не загружаются 😢 Попробуй позже.");
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

// Перевод с английского через MyMemory (бесплатно, без ключа), по кускам ~400 символов
async function translateToRu(text) {
  if (!text) return "";
  const chunks = [];
  let rest = text;
  while (rest.length > 400) {
    let cut = rest.lastIndexOf(". ", 400);
    if (cut < 100) cut = rest.lastIndexOf(" ", 400);
    chunks.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1).trim();
  }
  chunks.push(rest);

  const out = [];
  for (const c of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(c)}&langpair=en|ru`;
    const res = await fetch(url);
    const data = await res.json();
    out.push(data.responseData?.translatedText || c);
  }
  return out.join(" ");
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

  const shown = await shownMarkers();
  const fresh = breeds.filter((b) => !shown.has(`кот:${b.id}`));
  const pool = fresh.length ? fresh : breeds; // все породы показаны — повторяемся
  const breed = pool[Math.floor(Math.random() * pool.length)];

  // Переводим название, описание и характер один раз, кэшируем в файле
  let cached = false;
  if (!breed.name_ru) {
    breed.name_ru = await translateToRu(breed.name);
    cached = true;
  }
  if (!breed.description_ru && breed.description) {
    breed.description_ru = await translateToRu(breed.description);
    breed.temperament_ru = await translateToRu(breed.temperament);
    cached = true;
  }
  if (cached) saveBreeds(breeds);

  const caption = [
    `🐱 <b>${breed.name}</b>${breed.name_ru ? ` — ${breed.name_ru}` : ""}${breed.origin ? ` (${breed.origin})` : ""}`,
    breed.temperament_ru ? `Характер: ${breed.temperament_ru}.` : "",
    breed.description_ru || breed.description || "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);

  // До 3 попыток получить фото, которое реально загружается
  let sent = false;
  for (let attempt = 0; attempt < 3 && !sent; attempt++) {
    const imgRes = await fetch(`https://api.thecatapi.com/v1/images/search?breed_ids=${breed.id}&limit=1`, {
      headers: { "x-api-key": CATAPI_KEY },
    });
    const [img] = await imgRes.json();
    if (img?.url) sent = await sendPhotoChecked(msg, img.url, caption);
  }
  if (!sent) await reply(msg, caption); // фото нет — хотя бы текст

  await logMessage(botUsername, `[кот: ${breed.id}] ${breed.name}`, "bot");
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

    if (!msg.text) {
      return reply(msg, "Я понимаю только команды. Список: /help");
    }

    await reply(msg, "Я понимаю только команды:\n/meme — мем\n/cat — котик");
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
      { command: "meme", description: "Случайный мем" },
      { command: "cat", description: "Случайный котик: порода и факты" },
      { command: "help", description: "Справка" },
    ],
  });
  console.log(`Бот @${botUsername} запущен, ожидаю сообщения...`);
  await poll(0);
})();
