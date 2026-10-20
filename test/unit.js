// Unit tests for the pure parts of the bot: payload extraction, name
// generation, answer matching, the shared cache, and URL building.
//
//   node test/run.js

import assert from "node:assert/strict";

import { AnswerCache } from "../lib/answer-cache.js";
import { extractQuestion, stripHtml } from "../lib/question.js";
import {
  endpointFor,
  matchChoice,
  matchChoices,
  normalizeForMatch,
  parseChoiceReference,
  stripAnswerFraming,
} from "../lib/resolver.js";
import {
  NAME_MAX_LENGTH,
  insertInvisible,
  invisibleWidth,
  parseNameExpression,
  visibleName,
} from "../lib/names.js";
import { loadConfig, parsePin } from "../lib/config.js";

import {
  CHALLENGE_QUIZ,
  CONTENT,
  JUMBLE,
  OPEN_ENDED,
  QUIZ_FOUR_TEXT,
  QUIZ_IMAGE_CHOICES,
  QUIZ_TRUE_FALSE,
  SURVEY,
} from "./fixtures.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* -------------------------------------------------------------- extraction */

test("extract: reads the question text from title", () => {
  const question = extractQuestion(QUIZ_FOUR_TEXT);
  assert.equal(question.text, "Which of the below is one thing quantum computers can't do?");
  assert.equal(question.index, 5);
  assert.equal(question.type, "quiz");
  assert.equal(question.choices.length, 4);
  assert.equal(question.numberOfChoices, 4);
  assert.equal(question.numberOfAnswersAllowed, 1);
  assert.equal(question.multiSelect, false);
  assert.equal(question.questionsHidden, false);
});

test("extract: strips the HTML Kahoot puts in titles", () => {
  const question = extractQuestion(QUIZ_TRUE_FALSE);
  assert.equal(
    question.text,
    "True or false - The Beyond Meat fried chicken at a KFC in Atlanta, GA, sold out 5 hours after launch.",
  );
  assert.deepEqual(question.choices.map((c) => c.text), ["True", "False"]);
});

test("extract: reads picture options from image.altText", () => {
  const question = extractQuestion(QUIZ_IMAGE_CHOICES);
  assert.equal(question.text, "Find the flag of Switzerland.");
  assert.deepEqual(question.choices.map((c) => c.text), [
    "swiss flag",
    "austrian flag",
    "Graphic of the blue and yellow Swedish national flag",
    "Flat Flag of Albania",
  ]);
});

test("extract: handles jumble, open ended, survey and content blocks", () => {
  assert.equal(extractQuestion(JUMBLE).type, "jumble");
  assert.equal(extractQuestion(JUMBLE).choices.length, 4);

  const openEnded = extractQuestion(OPEN_ENDED);
  assert.equal(openEnded.type, "open_ended");
  assert.equal(openEnded.choices.length, 0);
  assert.ok(openEnded.text.length > 0);

  assert.equal(extractQuestion(SURVEY).type, "survey");
  assert.equal(extractQuestion(CONTENT).type, "content");
  assert.equal(extractQuestion(CONTENT).choices.length, 0);
});

test("extract: finds the correct flag when the server sends one", () => {
  // Live games never send it; challenge pins always do.
  assert.equal(extractQuestion(QUIZ_FOUR_TEXT).correctIndex, -1);
  assert.equal(extractQuestion(CHALLENGE_QUIZ).correctIndex, 1);
});

test("extract: reads the challenge 'question' field as well as 'title'", () => {
  const question = extractQuestion(CHALLENGE_QUIZ);
  assert.equal(question.text, "จิตวิทยา Psychology มีรากศัพท์มาจากภาษาอะไร?");
  assert.equal(question.correctIndex, 1);
});

test("extract: survives a payload with nothing in it", () => {
  const question = extractQuestion(undefined);
  assert.equal(question.text, "");
  assert.equal(question.choices.length, 0);
  assert.equal(question.correctIndex, -1);
  assert.equal(question.index, 0);
});

/* ------------------------------------------------------------------ html */

test("stripHtml: decodes entities and removes tags", () => {
  assert.equal(stripHtml("<b>hello</b>"), "hello");
  assert.equal(stripHtml("a &amp; b"), "a & b");
  assert.equal(stripHtml("it&#39;s"), "it's");
  assert.equal(stripHtml("caf&eacute;"), "café");
  assert.equal(stripHtml("line<br>break"), "line break");
});

test("stripHtml: does not strip escaped markup", () => {
  // Decoding happens after tag removal, so escaped tags survive as text.
  assert.equal(stripHtml("&lt;b&gt;bold&lt;/b&gt;"), "<b>bold</b>");
});

/* ----------------------------------------------------------------- names */

test("names: plain, numbered and identical groups", () => {
  assert.deepEqual(parseNameExpression("Player").names, ["Player"]);

  const numbered = parseNameExpression("Player*3");
  assert.deepEqual(numbered.names, ["Player1", "Player2", "Player3"]);

  const identical = parseNameExpression("Player~3");
  assert.equal(identical.names.length, 3);
  // Different on the wire, the same to a player.
  assert.equal(new Set(identical.names).size, 3);
  assert.equal(new Set(identical.names.map(visibleName)).size, 1);
  assert.equal(visibleName(identical.names[0]), "Player");
});

test("names: the zero-width run sits inside the word, not at the end", () => {
  const [name] = parseNameExpression("Player~2").names;
  assert.ok(!name.endsWith("\u200B"), "must not be appended");
  const index = name.search(/[\u200B\u200C\u200D\u2060]/);
  assert.ok(index > 0, "must not be at the start");
  assert.ok(index < "Player".length, "must be inside the word");
});

test("names: everything fits inside the 15 character limit", () => {
  const long = "VeryLongBotNameIndeed";
  const names = parseNameExpression(`${long}~40`).names;
  for (const name of names) {
    assert.ok(name.length <= NAME_MAX_LENGTH, `${name.length} characters`);
  }
  assert.equal(new Set(names).size, 40, "still 40 distinct names");
});

test("names: numbered names are truncated but stay distinct", () => {
  const names = parseNameExpression("AVeryLongBotName*5").names;
  assert.equal(new Set(names).size, 5);
  for (const name of names) {
    assert.ok(name.length <= NAME_MAX_LENGTH);
  }
});

test("names: rejects nonsense", () => {
  assert.ok(parseNameExpression("").error);
  assert.ok(parseNameExpression("Player*0").error);
  assert.ok(parseNameExpression("Player*x").error);
  assert.ok(parseNameExpression("Player*99999", { maxBatchSize: 10000 }).error);
});

test("names: helper widths", () => {
  assert.equal(invisibleWidth(1), 1);
  assert.equal(invisibleWidth(4), 1);
  assert.equal(invisibleWidth(5), 2);
  assert.equal(insertInvisible("Hi", "\u200B"), "H\u200Bi");
  // A one character word cannot be split.
  assert.equal(insertInvisible("A B", "\u200B"), "A B\u200B");
});

/* --------------------------------------------------------------- matching */

const PLANET_CHOICES = ["Venus", "Mercury", "Mars", "Jupiter"];

test("match: exact text", () => {
  assert.equal(matchChoice("Mercury", PLANET_CHOICES), 1);
  assert.equal(matchChoice("mercury", PLANET_CHOICES), 1);
});

test("match: model framing survives", () => {
  assert.equal(matchChoice("The answer is 2.", ["Apple", "Banana", "Cherry"]), 1);
  assert.equal(matchChoice("The answer is B.", PLANET_CHOICES), 1);
  assert.equal(matchChoice("B) Mercury", PLANET_CHOICES), 1);
  assert.equal(matchChoice("The correct answer is Mercury.", PLANET_CHOICES), 1);
});

test("match: bare positions", () => {
  assert.equal(matchChoice("2", ["Apple", "Banana"]), 1);
  assert.equal(matchChoice("B", PLANET_CHOICES), 1);
  assert.equal(matchChoice("option c", PLANET_CHOICES), 2);
  assert.equal(matchChoice("9", PLANET_CHOICES), -1, "out of range");
});

test("match: punctuation and accents do not matter", () => {
  assert.equal(matchChoice("café", ["Cafe", "Tea"]), 0);
  assert.equal(matchChoice("don't", ["Dont", "Do not"]), 0);
});

test("match: refuses to guess when nothing fits", () => {
  assert.equal(matchChoice("completely unrelated wording", PLANET_CHOICES), -1);
  assert.equal(matchChoice("", PLANET_CHOICES), -1);
  assert.equal(matchChoice("Mercury", []), -1);
});

test("match: prefers the longest option over a short prefix", () => {
  const choices = ["2", "2 Mercury", "Venus"];
  assert.equal(matchChoice("2 Mercury", choices), 1);
});

test("match: multiple answers for multi-select", () => {
  const choices = ["Apple", "Banana", "Cherry", "Date"];
  assert.deepEqual(matchChoices("Apple\nCherry", choices), [0, 2]);
  assert.deepEqual(matchChoices("Apple, Cherry", choices), [0, 2]);
  assert.deepEqual(matchChoices("Apple", choices), [0]);
});

test("match: helpers", () => {
  assert.equal(normalizeForMatch("  Hello,  World!  "), "hello world");
  assert.equal(stripAnswerFraming("The answer is Mercury."), "Mercury");
  assert.equal(parseChoiceReference("c", 4), 2);
  assert.equal(parseChoiceReference("z", 4), -1);
});

/* ------------------------------------------------------------------ cache */

test("cache: 150 bots cause one resolver call", async () => {
  const cache = new AnswerCache();
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return "Mercury";
  };

  const results = await Promise.all(Array.from({ length: 150 }, () => cache.get(0, resolve)));
  assert.equal(calls, 1, "one call for the whole lobby");
  assert.deepEqual(new Set(results), new Set(["Mercury"]));
});

test("cache: different questions are different entries", async () => {
  const cache = new AnswerCache();
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    return `answer-${calls}`;
  };
  await cache.get(0, resolve);
  await cache.get(1, resolve);
  assert.equal(calls, 2);
  await cache.get(0, resolve);
  assert.equal(calls, 2, "cached");
});

test("cache: clearing resets everything", async () => {
  const cache = new AnswerCache();
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    return "x";
  };
  await cache.get(0, resolve);
  cache.clear();
  await cache.get(0, resolve);
  assert.equal(calls, 2);
});

test("cache: a failed resolution is not cached", async () => {
  const cache = new AnswerCache();
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    throw new Error("boom");
  };
  await assert.rejects(() => cache.get(0, resolve));
  await assert.rejects(() => cache.get(0, resolve));
  assert.equal(calls, 2, "the failure is retried, not remembered");
});

/* ------------------------------------------------------------------ urls */

test("urls: chat completions endpoint from any base", () => {
  assert.equal(endpointFor("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpointFor("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpointFor("http://localhost:11434"), "http://localhost:11434/v1/chat/completions");
  assert.equal(endpointFor("https://x/v1/chat/completions"), "https://x/v1/chat/completions");
  assert.equal(endpointFor(""), "");
  assert.equal(endpointFor(undefined), "");
});

/* ---------------------------------------------------------------- config */

test("pins: a challenge pin keeps its leading zero", () => {
  assert.equal(parsePin("00112233"), "00112233");
  assert.equal(parsePin("12345"), "12345");
  assert.equal(parsePin(" 98765 "), "98765");
  assert.equal(parsePin("0"), "");
  assert.equal(parsePin("abc"), "");
  assert.equal(parsePin(""), "");
  assert.equal(parsePin(undefined), "");
});

test("config: environment defaults", () => {
  const config = loadConfig({ RESEND: "5", PARALLEL: "10", RESOLVER_MODEL: "llama3" });
  assert.equal(config.resend, 5);
  assert.equal(config.parallel, 10);
  assert.equal(config.model, "llama3");
  assert.equal(config.mode, "perfect");

  const defaults = loadConfig({});
  assert.equal(defaults.resend, 0);
  assert.equal(defaults.parallel, 35);
  assert.equal(defaults.feedbackBurst, 0);
});

export { tests };
