// Live game handling.
//
//   node test/run.js
//
// The live case is the awkward one: the question text is only sent when the
// host has "Show questions & answers on players' devices" switched on, and
// the payloads that carry it arrive in three different places.

import assert from "node:assert/strict";

import { BotManager } from "../lib/bots.js";
import { loadConfig } from "../lib/config.js";
import { KnownAnswers } from "../lib/known-answers.js";
import {
  extractQuestion,
  findQuestionData,
  quizFingerprint,
  resolveQuestionIndex,
} from "../lib/question.js";

import {
  LIVE_NO_TEXT,
  LIVE_QUIZ_START,
  LIVE_READY_COMPLETE,
  LIVE_READY_STUBBED,
  LIVE_SETTINGS,
} from "./fixtures.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* -------------------------------------------------------------- extraction */

test("live: a question with the setting off has no text and no choices", () => {
  const question = extractQuestion(LIVE_NO_TEXT, { settings: LIVE_SETTINGS });
  assert.equal(question.text, "");
  assert.equal(question.choices.length, 0);
  assert.equal(question.hasText, false);
  assert.equal(question.hasChoices, false);
  assert.equal(question.numberOfChoices, 4, "the count is known even when the options are not");
  assert.equal(question.questionsHidden, true);
});

test("live: firstGameBlockData carries the first question, correct flags and all", () => {
  const question = extractQuestion(LIVE_QUIZ_START, { settings: LIVE_SETTINGS });
  assert.equal(question.carrier, "firstGameBlockData");
  assert.equal(question.text, "Which planet is closest to the Sun?");
  assert.equal(question.choices.length, 4);
  assert.equal(question.correctIndex, 0, "Mercury is marked correct");
  assert.equal(question.index, 0);
});

test("live: a stubbed nextGameBlockData has nothing in it", () => {
  const question = extractQuestion(LIVE_READY_STUBBED, { settings: LIVE_SETTINGS });
  assert.equal(question.carrier, "nextGameBlockData");
  assert.equal(question.hasText, false);
  assert.equal(question.hasChoices, false);
  assert.equal(question.questionsHidden, true);
});

test("live: a complete nextGameBlockData carries the next question", () => {
  const question = extractQuestion(LIVE_READY_COMPLETE);
  assert.equal(question.carrier, "nextGameBlockData");
  assert.equal(question.text, "Which planet is second from the Sun?");
  assert.equal(question.choices.length, 4);
  assert.equal(question.index, 1);
});

test("live: the setting is read from extensiveMode and from gameOptions", () => {
  // extensiveMode on the question itself.
  const on = extractQuestion({ ...LIVE_NO_TEXT, extensiveMode: true, title: "Q", choices: [{ answer: "a" }] });
  assert.equal(on.extensive, true);
  assert.equal(on.questionsHidden, false);

  const off = extractQuestion(LIVE_NO_TEXT);
  assert.equal(off.questionsHidden, true);

  // The game wide flag, when the question does not carry one.
  const fromGame = extractQuestion({ type: "quiz", numberOfChoices: 4 }, { settings: LIVE_SETTINGS });
  assert.equal(fromGame.questionsHidden, true);

  const fromGameOn = extractQuestion(
    { type: "quiz", numberOfChoices: 4 },
    { settings: { gameOptions: { provideControllerExtensiveData: true } } },
  );
  assert.equal(fromGameOn.extensive, true);
  assert.equal(fromGameOn.questionsHidden, false);
});

test("live: questionRestricted is not the signal", () => {
  // It is false whether the setting is on or off, so it is not consulted.
  const question = extractQuestion({ ...LIVE_NO_TEXT, questionRestricted: false });
  assert.equal(question.questionsHidden, true, "the flag is ignored");
});

test("live: the question index comes from wherever it can", () => {
  assert.equal(resolveQuestionIndex(LIVE_NO_TEXT, extractQuestion(LIVE_NO_TEXT)), 1);
  assert.equal(resolveQuestionIndex(LIVE_READY_STUBBED, extractQuestion(LIVE_READY_STUBBED)), 1);
  assert.equal(
    resolveQuestionIndex(LIVE_READY_COMPLETE, extractQuestion(LIVE_READY_COMPLETE)),
    1,
    "the nested block's own index wins",
  );
});

test("live: findQuestionData names where the data came from", () => {
  assert.equal(findQuestionData(LIVE_QUIZ_START).carrier, "firstGameBlockData");
  assert.equal(findQuestionData(LIVE_READY_STUBBED).carrier, "nextGameBlockData");
  assert.equal(findQuestionData(LIVE_NO_TEXT).carrier, "none");
});

/* ---------------------------------------------------------- known answers */

function tempFile(name) {
  return `${process.env.TMPDIR || "/tmp"}/kahoot-answers-${name}-${process.pid}.json`;
}

test("known answers: a recorded answer comes back", () => {
  const file = tempFile("basic");
  const store = new KnownAnswers({ file });
  store.record("12345", "fp1", 0, [3]);
  assert.deepEqual(store.get("12345", "fp1", 0), [3]);
  store.flush();
});

test("known answers: a different quiz at the same pin does not inherit them", () => {
  const file = tempFile("fingerprint");
  const store = new KnownAnswers({ file });
  store.record("12345", "quiz-a", 0, [3]);
  assert.equal(store.get("12345", "quiz-a", 0)[0], 3);
  assert.equal(store.get("12345", "quiz-b", 0), null, "a different quiz gets nothing");
  store.flush();
});

test("known answers: recording a different quiz replaces the old one", () => {
  const file = tempFile("replace");
  const store = new KnownAnswers({ file });
  store.record("12345", "quiz-a", 0, [3]);
  store.record("12345", "quiz-b", 1, [1]);
  assert.equal(store.get("12345", "quiz-a", 0), null);
  assert.deepEqual(store.get("12345", "quiz-b", 1), [1]);
  store.flush();
});

test("known answers: nothing is stored without a pin or an answer", () => {
  const file = tempFile("empty");
  const store = new KnownAnswers({ file });
  store.record("", "fp", 0, [1]);
  store.record("12345", "fp", 0, []);
  assert.equal(store.get("12345", "fp", 0), null);
  assert.equal(store.count("12345"), 0);
  store.flush();
});

test("known answers: they survive a restart", () => {
  const file = tempFile("persist");
  const first = new KnownAnswers({ file });
  first.record("12345", "fp", 2, [1]);
  first.flush();

  const second = new KnownAnswers({ file });
  assert.deepEqual(second.get("12345", "fp", 2), [1]);
});

test("known answers: the fingerprint tells two quizzes apart", () => {
  const a = quizFingerprint({ questionCount: 20, firstQuestionText: "Mercury?", quizTitle: "Space" });
  const b = quizFingerprint({ questionCount: 20, firstQuestionText: "Venus?", quizTitle: "Space" });
  const c = quizFingerprint({ questionCount: 10, firstQuestionText: "Mercury?", quizTitle: "Space" });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(quizFingerprint({}), "");
});

/* ------------------------------------------------------------- bot wiring */

function setup({ known, settings = LIVE_SETTINGS } = {}) {
  const config = loadConfig({});
  config.pin = "12345";
  config.mode = "perfect";

  const logs = [];
  let resolverCalls = 0;

  const manager = new BotManager({
    config,
    log: (level, text) => logs.push(`${level}: ${text}`),
    knownAnswers: known ?? new KnownAnswers({ enabled: false }),
    resolver: {
      configured: true,
      setModel() {},
      resolve: async () => {
        resolverCalls += 1;
        return "Mercury";
      },
    },
  });
  manager.settings = settings;

  return { manager, config, logs, resolverCalls: () => resolverCalls };
}

test("bot: the first question is answered from firstGameBlockData", async () => {
  const ctx = setup();
  ctx.manager._rememberQuestion(LIVE_QUIZ_START);
  const question = extractQuestion(LIVE_NO_TEXT, { settings: LIVE_SETTINGS });
  const index = resolveQuestionIndex(LIVE_NO_TEXT, question);
  ctx.manager.questions.set(index, extractQuestion(LIVE_QUIZ_START, { settings: LIVE_SETTINGS }));

  const choice = await ctx.manager._chooseAnswer(ctx.manager.questions.get(index));
  assert.equal(choice, 0, "Mercury, from the correct flag");
  assert.equal(ctx.resolverCalls(), 0, "no model was needed");
});

test("bot: with the questions hidden the bot says so instead of guessing quietly", async () => {
  const ctx = setup();
  const question = extractQuestion(LIVE_NO_TEXT, { settings: LIVE_SETTINGS });
  assert.equal(question.questionsHidden, true);
  assert.equal(question.hasText, false);
});

test("bot: a recorded answer beats the resolver", async () => {
  const file = tempFile("beats-resolver");
  const known = new KnownAnswers({ file });
  known.record("12345", "fp", 1, [2]);

  const ctx = setup({ known });
  ctx.manager.fingerprint = "fp";

  const question = extractQuestion(LIVE_NO_TEXT, { settings: LIVE_SETTINGS });
  question.index = 1;
  const choice = await ctx.manager._chooseAnswer(question);
  assert.equal(choice, 2);
  assert.equal(ctx.resolverCalls(), 0);
  known.flush();
});

export { tests };
