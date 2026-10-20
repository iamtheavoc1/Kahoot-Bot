// Test runner.
//
//   node test/run.js              unit tests only
//   node test/run.js --integration  also run the live challenge test
//
// The integration test joins a public Kahoot challenge and checks that the
// bot answers it correctly. Challenges run entirely on Kahoot's side, so no
// host, no live game and no API key are needed.

import { tests } from "./unit.js";
import { tests as commandTests } from "./commands.js";
import { tests as botTests } from "./bot-logic.js";
import { tests as resolverTests } from "./resolver-http.js";
import { tests as liveTests } from "./live.js";
import { tests as reactionTests } from "./reaction.js";

const all = [...tests, ...commandTests, ...botTests, ...resolverTests, ...liveTests, ...reactionTests];

let passed = 0;
const failures = [];

for (const { name, fn } of all) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err?.message ?? err}`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);

if (process.argv.includes("--integration")) {
  const { runIntegration } = await import("./integration.js");
  const ok = await runIntegration();
  if (!ok) {
    process.exitCode = 1;
  }
}

if (process.argv.includes("--scale")) {
  const { runScale } = await import("./scale.js");
  const ok = await runScale();
  if (!ok) {
    process.exitCode = 1;
  }
}

if (failures.length > 0) {
  console.log("\nfirst failure:");
  console.error(failures[0].err);
  process.exitCode = 1;
}
