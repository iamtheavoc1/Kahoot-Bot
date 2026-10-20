// Live integration test.
//
//   node test/run.js --integration
//
// Joins a public Kahoot challenge and checks that the bot answers it
// correctly. Challenges are played against Kahoot's own REST API rather than
// a live lobby, so this needs no host, no live game and no API key -- and it
// exercises the same code path as a real game: join, read the question,
// choose an answer, send it, get scored.
//
// The challenge pins the correct flag, so the bot takes the challenge
// shortcut instead of asking a model. The resolver path is covered by the
// unit tests.

import assert from "node:assert/strict";

import { BotManager } from "../lib/bots.js";
import { loadConfig } from "../lib/config.js";

const DEFAULT_PIN = "00112233";
const TIMEOUT_MS = 120000;

export async function runIntegration() {
  const pin = process.env.CHALLENGE_PIN || DEFAULT_PIN;
  const config = loadConfig({});
  config.pin = String(pin);
  config.mode = "perfect";

  const results = [];
  let finish;
  const answered = new Promise((resolve) => {
    finish = resolve;
  });

  const manager = new BotManager({
    config,
    log: (level, text) => console.log(`    [${level}] ${text}`),
    onQuestionEnd: (bot, payload) => {
      results.push(payload);
      finish();
    },
  });

  console.log(`  joining challenge ${pin}...`);
  await manager.addBots(["integration-bot"]);

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("timed out waiting for the first question")), TIMEOUT_MS);
  });

  try {
    await Promise.race([answered, timeout]);
  } finally {
    await manager.shutdown();
  }

  const first = results[0];
  console.log(
    `    questionEnd: isCorrect=${first.isCorrect} correctChoices=${JSON.stringify(first.correctChoices)} choice=${first.choice}`,
  );

  assert.ok(results.length > 0, "no question was answered");
  assert.equal(first.isCorrect, true, "the bot answered the challenge incorrectly");
  assert.ok(Array.isArray(first.correctChoices), "the server did not report correctChoices");

  console.log("  ok   the bot joins a challenge and answers it correctly");
  return true;
}
