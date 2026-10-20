// Bot answering logic.
//
//   node test/run.js
//
// Checks the path from a captured payload to a chosen answer, with a stub
// resolver in place of a model. No network.

import assert from "node:assert/strict";

import { BotManager } from "../lib/bots.js";
import { loadConfig } from "../lib/config.js";
import { extractQuestion } from "../lib/question.js";

import { CHALLENGE_QUIZ, QUIZ_FOUR_TEXT } from "./fixtures.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const PLANET_PAYLOAD = {
  type: "quiz",
  gameBlockType: "quiz",
  questionIndex: 0,
  title: "Which planet is closest to the Sun?",
  numberOfChoices: 4,
  numberOfAnswersAllowed: 1,
  choices: [{ answer: "Mercury" }, { answer: "Venus" }, { answer: "Earth" }, { answer: "Mars" }],
};

function setup({ reply = "Mercury", mode = "perfect", resolverConfigured = true, fail = false } = {}) {
  const config = loadConfig({});
  config.pin = "12345";
  config.mode = mode;

  let calls = 0;
  const logs = [];

  const manager = new BotManager({
    config,
    log: (level, text) => logs.push(`${level}: ${text}`),
    resolver: {
      configured: resolverConfigured,
      setModel() {},
      resolve: async () => {
        calls += 1;
        if (fail) {
          throw new Error("resolver exploded");
        }
        return reply;
      },
    },
  });

  return {
    manager,
    config,
    logs,
    calls: () => calls,
  };
}

test("bot: the model reply becomes a choice index", async () => {
  const ctx = setup({ reply: "Mercury" });
  const choice = await ctx.manager._chooseAnswer(extractQuestion(PLANET_PAYLOAD));
  assert.equal(choice, 0);
});

test("bot: a framed reply still lands on the right option", async () => {
  const ctx = setup({ reply: "The answer is 2." });
  const choice = await ctx.manager._chooseAnswer(extractQuestion(PLANET_PAYLOAD));
  assert.equal(choice, 1, "Venus");
});

test("bot: a lettered reply lands on the right option", async () => {
  const ctx = setup({ reply: "C) Earth" });
  const choice = await ctx.manager._chooseAnswer(extractQuestion(PLANET_PAYLOAD));
  assert.equal(choice, 2);
});

test("bot: one resolver call covers every bot", async () => {
  const ctx = setup({ reply: "Mercury" });
  const question = extractQuestion(PLANET_PAYLOAD);
  await Promise.all(Array.from({ length: 150 }, () => ctx.manager._chooseAnswer(question)));
  assert.equal(ctx.calls(), 1);
});

test("bot: a question with the correct flag needs no resolver", async () => {
  const ctx = setup({ reply: "wrong on purpose" });
  const choice = await ctx.manager._chooseAnswer(extractQuestion(CHALLENGE_QUIZ));
  assert.equal(choice, 1, "the correct option");
  assert.equal(ctx.calls(), 0, "the resolver was never asked");
});

test("bot: chaos mode answers at random even when the answer is known", async () => {
  const ctx = setup({ mode: "chaos" });
  const question = extractQuestion(CHALLENGE_QUIZ);
  const picks = new Set();
  for (let run = 0; run < 40; run += 1) {
    picks.add(await ctx.manager._chooseAnswer(question));
  }
  assert.ok(picks.size > 1, "chaos should not always pick the correct option");
  assert.equal(ctx.calls(), 0);
});

test("bot: a multi-select question returns a list of indexes", async () => {
  const ctx = setup({ reply: "Mercury\nVenus" });
  const payload = {
    ...PLANET_PAYLOAD,
    numberOfAnswersAllowed: 2,
    gameBlockType: "multiple_select_quiz",
    type: "multiple_select_quiz",
  };
  const choice = await ctx.manager._chooseAnswer(extractQuestion(payload));
  assert.ok(Array.isArray(choice));
  assert.deepEqual(choice, [0, 1]);
});

test("bot: a hidden question falls back to a guess without asking anyone", async () => {
  const ctx = setup();
  const payload = { type: "quiz", gameBlockType: "quiz", questionIndex: 0, choices: [] };
  const question = extractQuestion(payload);
  const choice = await ctx.manager._chooseAnswer(question);
  assert.ok(choice === null || typeof choice === "number");
  assert.equal(ctx.calls(), 0);
});

test("bot: a broken resolver falls back to a guess instead of throwing", async () => {
  const ctx = setup({ fail: true });
  const question = extractQuestion(PLANET_PAYLOAD);
  const choice = await ctx.manager._chooseAnswer(question);
  assert.ok(typeof choice === "number");
  assert.match(ctx.logs.at(-1), /resolver failed/);
});

test("bot: without a resolver the bot says so, once", async () => {
  const ctx = setup({ resolverConfigured: false });
  const question = extractQuestion(PLANET_PAYLOAD);
  await ctx.manager._chooseAnswer(question);
  await ctx.manager._chooseAnswer(question);
  const warnings = ctx.logs.filter((line) => /no resolver configured/.test(line));
  assert.equal(warnings.length, 1, "warned exactly once");
});

test("bot: a live question with no correct flag is not guessed from the payload", async () => {
  const ctx = setup();
  const question = extractQuestion(QUIZ_FOUR_TEXT);
  assert.equal(question.correctIndex, -1);
  assert.equal(ctx.calls(), 0);
});

export { tests };
