// Command layer tests.
//
//   node test/run.js
//
// Every command is exercised without a terminal, so the interactive surface
// does not depend on a working pty to be checked.

import assert from "node:assert/strict";

import { createCommands } from "../lib/commands.js";
import { visibleName } from "../lib/names.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function setup() {
  const logs = [];
  const calls = { added: [], kicked: [], kickAll: 0, burstSpam: 0, pins: [], models: [] };

  const config = {
    pin: "",
    mode: "perfect",
    resend: 0,
    spamEnabled: true,
    model: "gpt-4o-mini",
  };

  const manager = {
    kickAll: () => {
      calls.kickAll += 1;
    },
    setPin: (pin) => {
      calls.pins.push(pin);
      config.pin = pin;
    },
    addBots: async (names) => {
      calls.added.push(names);
    },
    kick: (name) => {
      calls.kicked.push(name);
      return name !== "missing";
    },
    setModel: (model) => {
      calls.models.push(model);
      config.model = model;
    },
    burstSpam: () => {
      calls.burstSpam += 1;
    },
    activeNames: () => [],
  };

  let exited = false;
  const commands = createCommands({
    manager,
    config,
    log: (level, text) => logs.push(`${level}: ${text}`),
    refresh: () => {},
    onExit: async () => {
      exited = true;
    },
  });

  return {
    commands,
    config,
    calls,
    logs,
    last: () => logs[logs.length - 1],
    wasExited: () => exited,
  };
}

/* ------------------------------------------------------------------- pin */

test("command: pin sets the pin and clears the previous lobby", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin 12345");
  assert.equal(ctx.config.pin, "12345");
  assert.equal(ctx.calls.kickAll, 1, "bots in the old game are removed");
  assert.match(ctx.last(), /PIN set to 12345/);
});

test("command: a challenge pin keeps its leading zero", async () => {
  const ctx = setup();
  await ctx.commands.handle("00112233");
  assert.equal(ctx.config.pin, "00112233");
  assert.equal(typeof ctx.config.pin, "string");
});

test("command: a bare number before a pin is set becomes the pin", async () => {
  const ctx = setup();
  await ctx.commands.handle("45678");
  assert.equal(ctx.config.pin, "45678");
});

test("command: bad pins are rejected", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin abc");
  assert.equal(ctx.config.pin, "");
  assert.match(ctx.last(), /Invalid PIN/);
});

test("command: setting the same pin again does not clear the lobby", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin 12345");
  ctx.calls.kickAll = 0;
  await ctx.commands.handle("pin 12345");
  assert.equal(ctx.calls.kickAll, 0);
  assert.match(ctx.last(), /PIN already/);
});

/* ------------------------------------------------------------------- add */

test("command: add creates one bot", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin 12345");
  await ctx.commands.handle("add Player");
  assert.deepEqual(ctx.calls.added.at(-1), ["Player"]);
});

test("command: add with a count expands to numbered names", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin 12345");
  await ctx.commands.handle("add Player*3");
  assert.deepEqual(ctx.calls.added.at(-1), ["Player1", "Player2", "Player3"]);
});

test("command: add with a tilde expands to identical looking names", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin 12345");
  await ctx.commands.handle("add Player~3");
  const names = ctx.calls.added.at(-1);
  assert.equal(names.length, 3);
  assert.equal(new Set(names).size, 3, "distinct on the wire");
  assert.equal(new Set(names.map(visibleName)).size, 1, "identical on screen");
});

test("command: add without a pin is refused", async () => {
  const ctx = setup();
  await ctx.commands.handle("add Player");
  assert.equal(ctx.calls.added.length, 0);
  assert.match(ctx.last(), /Set a PIN/);
});

/* ------------------------------------------------------------------ kick */

test("command: kick removes one bot, kick all removes every bot", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin 12345");
  await ctx.commands.handle("kick Player");
  assert.deepEqual(ctx.calls.kicked, ["Player"]);

  ctx.calls.kickAll = 0;
  await ctx.commands.handle("kick all");
  assert.equal(ctx.calls.kickAll, 1);
});

test("command: kicking a bot that is not there says so", async () => {
  const ctx = setup();
  await ctx.commands.handle("pin 12345");
  await ctx.commands.handle("kick missing");
  assert.match(ctx.last(), /Bot not found/);
});

/* ------------------------------------------------------------------ mode */

test("command: mode switches answering behaviour", async () => {
  const ctx = setup();
  for (const mode of ["perfect", "chaos", "apocalypse", "off"]) {
    await ctx.commands.handle(`mode ${mode}`);
    assert.equal(ctx.config.mode, mode);
  }
});

test("command: an unknown mode is refused", async () => {
  const ctx = setup();
  await ctx.commands.handle("mode sideways");
  assert.equal(ctx.config.mode, "perfect");
  assert.match(ctx.last(), /Unknown mode/);
});

/* ------------------------------------------------------- resend and model */

test("command: resend sets the number of extra packets", async () => {
  const ctx = setup();
  await ctx.commands.handle("resend 5");
  assert.equal(ctx.config.resend, 5);
});

test("command: resend rejects nonsense", async () => {
  const ctx = setup();
  await ctx.commands.handle("resend -1");
  assert.equal(ctx.config.resend, 0);
  assert.match(ctx.last(), /non-negative/);
});

test("command: model changes the resolver model", async () => {
  const ctx = setup();
  await ctx.commands.handle("model llama3.2");
  assert.equal(ctx.config.model, "llama3.2");
  assert.deepEqual(ctx.calls.models, ["llama3.2"]);
});

/* ------------------------------------------------------------------ spam */

test("command: spam toggles, and takes on, off or burst", async () => {
  const ctx = setup();
  assert.equal(ctx.config.spamEnabled, true);

  await ctx.commands.handle("spam");
  assert.equal(ctx.config.spamEnabled, false);

  await ctx.commands.handle("spam on");
  assert.equal(ctx.config.spamEnabled, true);

  await ctx.commands.handle("spam off");
  assert.equal(ctx.config.spamEnabled, false);

  await ctx.commands.handle("spam burst");
  assert.equal(ctx.calls.burstSpam, 1);
});

/* ----------------------------------------------------------------- misc */

test("command: help lists the commands", async () => {
  const ctx = setup();
  await ctx.commands.handle("help");
  assert.match(ctx.last(), /Commands:/);
  assert.match(ctx.last(), /add <name>\*<count>/);
});

test("command: exit shuts down", async () => {
  const ctx = setup();
  await ctx.commands.handle("exit");
  assert.equal(ctx.wasExited(), true);
});

test("command: unknown input is reported", async () => {
  const ctx = setup();
  await ctx.commands.handle("wibble");
  assert.match(ctx.last(), /Unknown command/);
});

test("command: blank input does nothing", async () => {
  const ctx = setup();
  await ctx.commands.handle("   ");
  assert.equal(ctx.logs.length, 0);
});

export { tests };
