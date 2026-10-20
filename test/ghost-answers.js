// Ghost answers.
//
//   node test/run.js
//
// The ghost answers endpoint is public: it needs no token and no session.
// Once a game has run a question it holds the answer key, in the same
// shapes Kahoot's own client uses.

import assert from "node:assert/strict";

import { answersByQuestion, ghostAnswersUrl } from "../lib/ghost-answers.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const QUIZ_EVENT = {
  type: "ANSWER",
  nickname: "someone",
  originalBlockIndex: 0,
  inGameBlockIndex: 0,
  answerData: { type: "quiz_async", choiceIndex: 2, isCorrect: true },
};

const MULTI_EVENT = {
  type: "ANSWER",
  inGameBlockIndex: 1,
  answerData: { type: "multiple_select_quiz_async", selectedChoices: [0, 3], isCorrect: true },
};

const JUMBLE_EVENT = {
  type: "ANSWER",
  inGameBlockIndex: 2,
  answerData: { type: "jumble_async", selectedJumbleOrder: [3, 1, 2, 0], isCorrect: true },
};

const SLIDER_EVENT = {
  type: "ANSWER",
  inGameBlockIndex: 3,
  answerData: { type: "slider_async", choiceValue: 380, isCorrect: true },
};

const OPEN_ENDED_EVENT = {
  type: "ANSWER",
  inGameBlockIndex: 4,
  answerData: { type: "open_ended_async", text: "Coral Pink", isCorrect: true },
};

test("ghost: the url is the one Kahoot's own client uses", () => {
  assert.equal(
    ghostAnswersUrl("abc-123"),
    "https://apis.kahoot.it/gameplay-services/events/v1/game/abc-123/answers",
  );
});

test("ghost: the events are read out of the envelope", () => {
  const map = answersByQuestion([{ event: QUIZ_EVENT }]);
  assert.deepEqual(map.get(0), [2]);
});

test("ghost: a bare event works too", () => {
  const map = answersByQuestion([QUIZ_EVENT]);
  assert.deepEqual(map.get(0), [2]);
});

test("ghost: every answer shape becomes an answer", () => {
  const map = answersByQuestion([QUIZ_EVENT, MULTI_EVENT, JUMBLE_EVENT, SLIDER_EVENT, OPEN_ENDED_EVENT]);

  assert.deepEqual(map.get(0), [2], "quiz");
  assert.deepEqual(map.get(1), [0, 3], "multi-select");
  assert.deepEqual(map.get(2), [3, 1, 2, 0], "jumble");
  assert.equal(map.get(3), 380, "slider, a value rather than an index");
  assert.equal(map.get(4), "Coral Pink", "open ended, text");
});

test("ghost: the in-game index is preferred over the original one", () => {
  const event = { ...QUIZ_EVENT, originalBlockIndex: 99, inGameBlockIndex: 4 };
  const map = answersByQuestion([event]);
  assert.deepEqual(map.get(4), [2]);
  assert.equal(map.get(99), undefined);
});

test("ghost: an event with no index is skipped", () => {
  const event = { type: "ANSWER", answerData: { type: "quiz_async", choiceIndex: 1 } };
  assert.equal(answersByQuestion([event]).size, 0);
});

test("ghost: an event with no answer data is skipped", () => {
  assert.equal(answersByQuestion([{ type: "ANSWER", inGameBlockIndex: 0 }]).size, 0);
});

export { tests };
