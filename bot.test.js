// node --test bot.test.js  (встроенный node:test, без зависимостей)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { esc, parseMarker, splitChunks } = require("./bot");

test("esc экранирует символы, ломающие HTML", () => {
  assert.equal(esc("<b>&'"), "&lt;b&gt;&amp;'"); // кавычки и апостроф не трогаем
  assert.equal(esc("обычный текст"), "обычный текст");
  assert.equal(esc(42), "42"); // не-строки приводим к строке
});

test("parseMarker разбирает только маркеры в начале строки", () => {
  assert.equal(parseMarker("[мем: 12345] Drake"), "мем:12345");
  assert.equal(parseMarker("[кот: abys] Abyssinian"), "кот:abys");
  assert.equal(parseMarker("[кот: sphy]"), "кот:sphy"); // без текста после
  assert.equal(parseMarker("привет [мем: 1]"), null); // не в начале — не маркер
  assert.equal(parseMarker("[dog: 1]"), null); // другой тип
  assert.equal(parseMarker(""), null);
});

test("splitChunks не превышает лимит и не теряет текст", () => {
  const long = "A".repeat(400) + "B".repeat(400) + "C".repeat(10); // без пробелов
  const chunks = splitChunks(long, 400);
  assert.ok(chunks.every((c) => c.length <= 400));
  assert.equal(chunks.join(""), long.replace(/\s+/g, "")); // текста не потеряно

  // раньше здесь был бесконечный цикл: lastIndexOf возвращал -1
  assert.doesNotThrow(() => splitChunks("x".repeat(1000), 400));
});

test("splitChunks режет по границе предложения", () => {
  const text = "Первое предложение здесь. Второе предложение здесь. Третье.";
  const chunks = splitChunks(text, 40);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), text);
  assert.ok(chunks.every((c) => c.length <= 40));
});
