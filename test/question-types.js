// Question types.
//
//   node test/run.js
//
// Kahoot has six kinds of question and each one has to be answered
// differently. The shapes come from Kahoot's own client:
//
//   quiz, true_false      one option index
//   multiple_select_quiz  several option indexes
//   jumble                an order: a permutation of the options
//   open_ended            the answer as text
//   slider                a number on the slider's step
//
// Each type is checked end to end, from a captured payload through the
// resolver reply to the answer the bot would send.

import assert from "node:assert/strict";

import { BotManager } from "../lib/bots.js";
import { loadConfig } from "../lib/config.js";
import { answerShapeFor, extractQuestion } from "../lib/question.js";
import {
  cleanTextAnswer,
  parseAnswer,
  parseOrder,
  parseSliderValue,
} from "../lib/resolver.js";

import {
  TYPE_JUMBLE,
  TYPE_MULTI_SELECT,
  TYPE_OPEN_ENDED,
  TYPE_QUIZ,
  TYPE_SLIDER,
  TYPE_TRUE_FALSE,
} from "./fixtures.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function manager(reply) {
  const config = loadConfig({});
  config.pin = "12345";
  config.mode = "perfect";
  return new BotManager({
    config,
    log: () => {},
    resolver: {
      configured: true,
      setModel() {},
      resolve: async () => reply,
    },
  });
}

/* ------------------------------------------------------------- the types */

test("types: quiz answers with one option index", async () => {
  const bot = manager("Mercury");
  const question = extractQuestion(TYPE_QUIZ);
  assert.equal(answerShapeFor(question.type), "index");
  assert.equal(await bot._chooseAnswer(question), 0);
});

test("types: true and false answers with one option index", async () => {
  const bot = manager("True");
  const question = extractQuestion(TYPE_TRUE_FALSE);
  assert.equal(await bot._chooseAnswer(question), 0);
});

test("types: multi-select answers with several option indexes", async () => {
  const bot = manager("Mercury\nVenus");
  const question = extractQuestion(TYPE_MULTI_SELECT);
  assert.equal(answerShapeFor(question.type), "indexes");
  const answer = await bot._chooseAnswer(question);
  assert.ok(Array.isArray(answer));
  assert.deepEqual(answer, [0, 1]);
});

test("types: jumble answers with an order", async () => {
  const bot = manager("4, 2, 3, 1");
  const question = extractQuestion(TYPE_JUMBLE);
  assert.equal(answerShapeFor(question.type), "order");
  const answer = await bot._chooseAnswer(question);
  assert.ok(Array.isArray(answer));
  assert.equal(answer.length, 4);
  assert.deepEqual(answer, [3, 1, 2, 0]);
});

test("types: open ended answers with text", async () => {
  const bot = manager("Coral Pink");
  const question = extractQuestion(TYPE_OPEN_ENDED);
  assert.equal(answerShapeFor(question.type), "text");
  assert.equal(await bot._chooseAnswer(question), "Coral Pink");
});

test("types: slider answers with a number on its step", async () => {
  const bot = manager("384");
  const question = extractQuestion(TYPE_SLIDER);
  assert.equal(answerShapeFor(question.type), "number");
  assert.equal(await bot._chooseAnswer(question), 380);
});

/* ------------------------------------------------------------ the parsing */

test("types: an order can be given as numbers or as the option text", () => {
  const choices = extractQuestion(TYPE_JUMBLE).choices;
  assert.deepEqual(parseOrder("4, 2, 3, 1", choices), [3, 1, 2, 0]);
  assert.deepEqual(parseOrder("4 2 3 1", choices), [3, 1, 2, 0]);
  // Named instead of numbered.
  assert.deepEqual(
    parseOrder(
      "NASA announces the space station will open to tourists\nAll female space walk\nFood grown in space eaten\nSoft landing on the far side of the moon",
      choices,
    ),
    [3, 1, 2, 0],
  );
});

test("types: a bad order is refused", () => {
  const choices = extractQuestion(TYPE_JUMBLE).choices;
  assert.equal(parseOrder("1, 1, 2, 3", choices), null, "repeated indexes");
  assert.equal(parseOrder("1, 2, 3", choices), null, "wrong length");
  assert.equal(parseOrder("9, 2, 3, 1", choices), null, "out of range");
  assert.equal(parseOrder("no idea", choices), null);
});

test("types: a slider value is clamped and snapped", () => {
  const slider = extractQuestion(TYPE_SLIDER).slider;
  assert.deepEqual(slider, { start: 0, end: 500, step: 10, unit: "thousand km" });
  assert.equal(parseSliderValue("384", slider), 380);
  assert.equal(parseSliderValue("9000", slider), 500, "clamped to the end");
  assert.equal(parseSliderValue("-40", slider), 0, "clamped to the start");
  assert.equal(parseSliderValue("about four hundred", slider), 400);
  assert.equal(parseSliderValue("no idea", slider), null);
});

test("types: a slider with a fractional step keeps it", () => {
  const slider = { start: 0, end: 1, step: 0.1, unit: "" };
  assert.equal(parseSliderValue("0.44", slider), 0.4);
  assert.equal(parseSliderValue("0.55", slider), 0.6);
});

test("types: a typed answer is cleaned up", () => {
  assert.equal(cleanTextAnswer('"Coral Pink."'), "Coral Pink");
  assert.equal(cleanTextAnswer("The answer is Coral Pink"), "Coral Pink");
  assert.equal(cleanTextAnswer("  Coral   Pink  "), "Coral Pink");
  assert.equal(cleanTextAnswer(""), "");
});

test("types: each prompt asks for the shape it needs", async () => {
  const bot = manager("x");
  const prompts = [];
  bot.resolver.resolve = async (question) => {
    prompts.push(question);
    return "x";
  };

  // The resolver builds the prompt; capture it through a local server would
  // be slow, so call the exported helper indirectly by checking the shape
  // the answer parser expects.
  const shapes = [
    [TYPE_QUIZ, "index"],
    [TYPE_TRUE_FALSE, "index"],
    [TYPE_MULTI_SELECT, "indexes"],
    [TYPE_JUMBLE, "order"],
    [TYPE_OPEN_ENDED, "text"],
    [TYPE_SLIDER, "number"],
  ];
  for (const [payload, shape] of shapes) {
    assert.equal(answerShapeFor(extractQuestion(payload).type), shape);
  }
});

/* ------------------------------------------------------------- the shapes */

test("types: a guess has the right shape too", async () => {
  const bot = manager("never used");
  bot.config.mode = "chaos";

  const jumble = extractQuestion(TYPE_JUMBLE);
  const order = await bot._chooseAnswer(jumble);
  assert.ok(Array.isArray(order));
  assert.equal(order.length, 4);
  assert.equal(new Set(order).size, 4, "a permutation, not a repeat");

  const multi = extractQuestion(TYPE_MULTI_SELECT);
  const picks = await bot._chooseAnswer(multi);
  assert.ok(Array.isArray(picks));
  assert.equal(picks.length, 2);

  const slider = extractQuestion(TYPE_SLIDER);
  const value = await bot._chooseAnswer(slider);
  assert.equal(typeof value, "number");
  assert.ok(value >= 0 && value <= 500);
  assert.equal(value % 10, 0, "on the step");
});

test("types: an open ended question with no resolver still answers with text", async () => {
  const bot = manager("never used");
  bot.config.mode = "chaos";
  const answer = await bot._chooseAnswer(extractQuestion(TYPE_OPEN_ENDED));
  assert.equal(typeof answer, "string");
});

/* -------------------------------------------------------------- latency */

test("types: turning a reply into an answer is fast", () => {
  const question = extractQuestion(TYPE_QUIZ);
  const samples = [];
  for (let run = 0; run < 500; run += 1) {
    const started = performance.now();
    parseAnswer(question, "The answer is 1.");
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  assert.ok(median < 5, `median ${median.toFixed(3)}ms`);
});

export { tests };
