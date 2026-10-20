// Reaction tests.
//
//   node test/run.js
//
// The reaction frame is not something the library provides, so these check
// the bytes on the wire against what Kahoot's own web client sends.

import assert from "node:assert/strict";

import {
  EMOTE_ID,
  EMOTE_TYPES,
  REACTION_ID,
  REACTION_TYPES,
  SAFE_INTERVAL_MS,
  SPAM_THRESHOLD,
  SPAM_WINDOW_MS,
  LiveEmote,
  LiveReaction,
  randomReaction,
} from "../lib/reaction.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const CLIENT = { gameid: "562917", clientId: "abc" };

test("reaction: the frame is game server code 47 on the controller channel", () => {
  const frame = new LiveReaction(CLIENT, "ThumbsUp");
  assert.equal(frame.channel, "/service/controller");
  assert.equal(frame.clientId, "abc");
  assert.deepEqual(frame.ext, {});
  assert.equal(frame.data.id, REACTION_ID);
  assert.equal(frame.data.id, 47);
  assert.equal(frame.data.type, "message");
  assert.equal(frame.data.gameid, "562917");
  assert.equal(frame.data.host, "kahoot.it");
});

test("reaction: the content is the reaction type", () => {
  const frame = new LiveReaction(CLIENT, "Clap");
  assert.equal(frame.data.content, JSON.stringify({ reactionType: "Clap" }));
  assert.deepEqual(JSON.parse(frame.data.content), { reactionType: "Clap" });
});

test("reaction: the shape matches the answer frame the library already sends", () => {
  // Same keys as LiveQuestionAnswer, only the code and the content differ.
  const frame = new LiveReaction(CLIENT, "Heart");
  assert.deepEqual(Object.keys(frame.data).sort(), ["content", "gameid", "host", "id", "type"]);
});

test("emote: game server code 48 with the emote type", () => {
  const frame = new LiveEmote(CLIENT, "Trophy");
  assert.equal(frame.data.id, EMOTE_ID);
  assert.equal(frame.data.id, 48);
  assert.equal(frame.data.content, JSON.stringify({ emoteType: "Trophy" }));
});

test("reaction: every type Kahoot's client offers is here", () => {
  assert.deepEqual(REACTION_TYPES, [
    "ThumbsUp",
    "Clap",
    "Heart",
    "Haha",
    "Wow",
    "Thinking",
    "Popper",
    "Trophy",
    "Flame",
    "Victory",
  ]);
  assert.deepEqual(EMOTE_TYPES, ["Heart", "Trophy", "Victory"]);
});

test("reaction: the spacing keeps one bot under Kahoot's spam threshold", () => {
  // Kahoot's client counts five reactions inside ten seconds as spam.
  assert.equal(SPAM_THRESHOLD, 5);
  assert.equal(SPAM_WINDOW_MS, 10000);
  // Four reactions fit in the window, so the fifth has to fall outside it.
  assert.ok((SPAM_THRESHOLD - 1) * SAFE_INTERVAL_MS >= SPAM_WINDOW_MS);
});

test("reaction: a random reaction is one of the real ones", () => {
  for (let run = 0; run < 50; run += 1) {
    assert.ok(REACTION_TYPES.includes(randomReaction()));
  }
});

export { tests };
