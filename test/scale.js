// Scale test.
//
//   node test/run.js --scale
//
// Joins a lot of bots to a Kahoot challenge at once and checks that they all
// connect and all answer correctly. Challenge pins are the only kind of game
// that can be driven without a host, and they exercise the same join path.
//
// This also tests the identical-name workaround against the real server:
// every bot in the group looks the same to a player but has a different
// zero-width run, so Kahoot must accept all of them as distinct players.
//
//   SCALE_BOTS=150 SCALE_PARALLEL=35 node test/run.js --scale

import assert from "node:assert/strict";

import { BotManager } from "../lib/bots.js";
import { loadConfig } from "../lib/config.js";
import { parseNameExpression } from "../lib/names.js";

export async function runScale() {
  const botCount = Number(process.env.SCALE_BOTS || 150);
  const parallel = Number(process.env.SCALE_PARALLEL || 35);
  const pin = String(process.env.CHALLENGE_PIN || "00112233");
  const timeoutMs = Number(process.env.SCALE_TIMEOUT || 180000);

  const config = loadConfig({});
  config.pin = pin;
  config.mode = "perfect";
  config.parallel = parallel;

  const answered = new Set();
  const failures = [];

  const manager = new BotManager({
    config,
    log: (level, text) => {
      if (level === "err" || level === "warn") {
        failures.push(text);
      }
    },
    onQuestionEnd: (bot, payload) => {
      answered.add(bot);
      if (!payload.isCorrect) {
        failures.push(`${bot.displayName} answered incorrectly`);
      }
    },
  });

  const names = parseNameExpression(`ScaleBot~${botCount}`).names;
  console.log(`  joining ${botCount} bots to challenge ${pin} (${parallel} at a time)...`);

  const started = Date.now();
  await manager.addBots(names);
  const joinMs = Date.now() - started;

  const connected = manager.activeNames().length;
  console.log(`  ${connected}/${botCount} connected in ${(joinMs / 1000).toFixed(1)}s`);

  const deadline = Date.now() + timeoutMs;
  while (answered.size < connected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`  ${answered.size}/${connected} answered the first question`);

  await manager.shutdown();

  const duplicates = failures.filter((text) => /name already in use/i.test(text));
  assert.equal(duplicates.length, 0, `the server rejected ${duplicates.length} names as duplicates`);
  assert.equal(connected, botCount, `only ${connected} of ${botCount} bots connected`);
  assert.equal(answered.size, connected, `only ${answered.size} of ${connected} bots answered`);
  assert.equal(
    failures.filter((text) => /answered incorrectly/.test(text)).length,
    0,
    "some bots answered incorrectly",
  );

  console.log(`  ok   ${botCount} bots joined and all answered correctly`);
  return true;
}
