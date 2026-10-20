// capture.js -- dump raw packets and settle the open questions in one run.
//
//   node capture.js <pin> [name] [options]
//
//   --log         print every SEND/RECV frame
//   --ready       also probe whether answering on QuestionReady is accepted
//   --react       probe whether a reaction frame is accepted
//   --react-burst <n>  fire n reactions as fast as possible and count them
//   --ghosts      fetch the answer key from the ghost answers endpoint
//   --ua <ua>     override the user agent sent in the login packet.
//                 --ua chrome uses a desktop Chrome string.
//   --print-frames  list every frame the library throws away
//
// What this is for:
//
// Kahoot only sends the question text when the host has "Show questions &
// answers on players' devices" switched on. With it off, QuestionStart
// carries no title and no choices, and the bot has nothing to resolve.
//
// This script answers three questions:
//
//   1. Is there a frame the library discards that carries the question?
//      The library handles a fixed set of packet ids. Everything else
//      arrives and is thrown away. This prints those frames and says
//      which of them mention a title or choices.
//   2. Does a real user agent change what the server sends? Kahoot decides
//      the payload shape from the device string in the login packet, and
//      the library sends a random one that can claim to be the W3C CSS
//      validator.
//   3. What do the block data fields look like? `firstGameBlockData` and
//      `nextGameBlockData` are reported in full.
//
// Known packet ids, from the library source. Anything else is discarded:
//
//   1 questionReady   2 questionStart   3 quizEnd      4 timeOver
//   5 gameReset       8 questionEnd     9 quizStart   10 twoFactorCorrect
//  12 feedback       13 podium        14 nameAccept  17 recovery
//  19 teamAccept     20 teamTalk      51 twoFactorReset  52 twoFactorWrong

import Kahoot from "kahoot.js-latest";

import { answersByQuestion, fetchGhostAnswers } from "./lib/ghost-answers.js";
import { EMOTE_TYPES, REACTION_TYPES, sendEmote, sendReaction } from "./lib/reaction.js";

// The `got` library inside kahoot.js-latest can throw this while a token
// request is being retried, and it is not something the library catches.
// Without a handler here it takes the whole script down.
process.on("uncaughtException", (err) => {
  console.error("uncaught:", err?.message ?? err);
});

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const KNOWN_IDS = new Set([1, 2, 3, 4, 5, 8, 9, 10, 12, 13, 14, 17, 19, 20, 51, 52, 53]);

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));

const uaIndex = args.indexOf("--ua");
let userAgent = null;
if (uaIndex !== -1) {
  const value = args[uaIndex + 1];
  if (value && !value.startsWith("--")) {
    userAgent = value === "chrome" ? CHROME_UA : value;
  }
}

const burstIndex = args.indexOf("--react-burst");
let reactBurst = 0;
if (burstIndex !== -1) {
  const value = args[burstIndex + 1];
  if (value && !value.startsWith("--")) {
    reactBurst = Number.parseInt(value, 10) || 0;
  }
}

const pin = Number(positional[0]);
const name = positional[1] || "capture";

if (!pin) {
  console.error(
    "usage: node capture.js <pin> [name] [--log] [--ready] [--react] [--react-burst <n>] [--ghosts] [--ua chrome] [--print-frames]",
  );
  process.exit(1);
}

const client = new Kahoot();
client.loggingMode = flags.has("--log");

if (userAgent) {
  // The library picks a random one, which can claim to be anything at all.
  // This is what goes into device.userAgent of the login packet.
  client.userAgent = userAgent;
  console.log(`user agent: ${userAgent}`);
}

// Every frame the socket receives, including the ones the library ignores.
const frames = [];
const originalMessage = client._message.bind(client);
client._message = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      frames.push(item);
    }
  } catch {
    /* not json, nothing to record */
  }
  originalMessage(raw);
};

const probes = {
  nameAccept: null,
  renamed: null,
  restricted: null,
  resend: null,
  readyAnswer: null,
  reaction: null,
  emote: null,
  burst: null,
  ghosts: null,
  correctChoices: null,
  extensiveModes: new Set(),
  sawTitle: false,
  sawChoices: false,
  gameOptions: null,
  firstGameBlockData: null,
  nextGameBlockData: null,
};

const dump = (label, obj) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, null, 2));
  console.log("keys:", Object.keys(obj ?? {}).join(", "));
};

function contentOf(frame) {
  const content = frame?.data?.content;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return content && typeof content === "object" ? content : null;
}

client.on("Joined", (settings) => {
  probes.gameOptions = settings?.gameOptions ?? null;
  console.log("settings:", JSON.stringify(settings));
  console.log(
    `PROBE provideControllerExtensiveData: ${
      settings?.gameOptions?.provideControllerExtensiveData ?? "(absent)"
    }`,
  );
  console.log(`PROBE reactions: ${settings?.gameOptions?.reactions ?? "(absent)"}`);

  if (flags.has("--react")) {
    probeReactions();
  }
  if (reactBurst > 0) {
    probeReactionBurst(reactBurst);
  }
});

/**
 * Probe the reaction frame. It is game server code 47 on /service/controller,
 * which the library has no class for. Reactions do not need a question, so
 * this runs as soon as the bot is in.
 */
async function probeReactions() {
  for (const type of REACTION_TYPES.slice(0, 3)) {
    try {
      const result = await sendReaction(client, type);
      probes.reaction = "accepted";
      console.log(`PROBE reaction ${type}: ACCEPTED timetrack=${result?.ext?.timetrack}`);
    } catch (err) {
      probes.reaction = "rejected";
      console.log(`PROBE reaction ${type}: REJECTED`, JSON.stringify(err));
    }
  }

  // The emote is a separate frame, code 48, with a different field.
  for (const type of EMOTE_TYPES.slice(0, 1)) {
    try {
      const result = await sendEmote(client, type);
      probes.emote = "accepted";
      console.log(`PROBE emote ${type}: ACCEPTED timetrack=${result?.ext?.timetrack}`);
    } catch (err) {
      probes.emote = "rejected";
      console.log(`PROBE emote ${type}: REJECTED`, JSON.stringify(err));
    }
  }
}

/**
 * Fire a lot of reactions as fast as possible and count how many the server
 * acknowledges.
 *
 * A cometd timetrack only says the frame was well formed, so this does not
 * prove anything showed up on the host's screen. It does show whether the
 * server drops them.
 */
async function probeReactionBurst(count) {
  let acknowledged = 0;
  let rejected = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: count }, async () => {
      try {
        await sendReaction(client, REACTION_TYPES[Math.floor(Math.random() * REACTION_TYPES.length)]);
        acknowledged += 1;
      } catch {
        rejected += 1;
      }
    }),
  );

  probes.burst = { sent: count, acknowledged, rejected };
  console.log(
    `PROBE reaction burst: ${count} sent in ${Date.now() - started}ms, ${acknowledged} acknowledged, ${rejected} rejected`,
  );
}

client.on("NameAccept", (info) => {
  probes.nameAccept = info;
  const assigned = String(info?.playerName ?? "");
  probes.renamed = assigned !== name;
  console.log("NameAccept:", JSON.stringify(info));
  console.log(
    `PROBE name: requested ${JSON.stringify(name)} -> assigned ${JSON.stringify(assigned)}` +
      (probes.renamed ? "  (RENAMED by Kahoot -- filter or truncation)" : "  (unchanged)"),
  );
});

client.on("QuizStart", (quiz) => {
  dump("QuizStart", quiz);
  probes.firstGameBlockData = quiz?.firstGameBlockData ?? null;
  if (probes.firstGameBlockData) {
    console.log("PROBE firstGameBlockData:", JSON.stringify(probes.firstGameBlockData));
  }
  console.log(`PROBE extensiveMode: ${String(quiz?.extensiveMode)}`);
  console.log(`PROBE gameId: ${String(quiz?.gameId)}`);
  console.log(`PROBE reactions: ${String(quiz?.reactions)}`);

  if (flags.has("--ghosts")) {
    probeGhostAnswers(quiz?.gameId);
  }
});

/**
 * The answer key, from the endpoint Kahoot's own web client uses for ghost
 * answers. It needs no token and no session.
 */
async function probeGhostAnswers(gameApiId) {
  if (!gameApiId) {
    console.log("PROBE ghosts: no gameId in the QuizStart payload");
    return;
  }

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const events = await fetchGhostAnswers(gameApiId);
      const byQuestion = answersByQuestion(events);
      probes.ghosts = byQuestion.size;
      console.log(
        `PROBE ghosts: ${events.length} events, ${byQuestion.size} questions answered`,
      );
      if (byQuestion.size > 0) {
        console.log("PROBE ghost answers:", JSON.stringify([...byQuestion.entries()]));
        console.log("PROBE raw events:", JSON.stringify(events).slice(0, 2000));
        return;
      }
    } catch (err) {
      console.log(`PROBE ghosts: ${err.message}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.log("PROBE ghosts: nothing came back");
}

client.on("QuestionReady", (question) => {
  dump("QuestionReady", question);
  probes.nextGameBlockData = question?.nextGameBlockData ?? null;
  if (probes.nextGameBlockData) {
    console.log("PROBE nextGameBlockData:", JSON.stringify(probes.nextGameBlockData));
  }

  if (!flags.has("--ready")) {
    return;
  }

  console.log("PROBE ready-answer: sending an answer before the question starts...");
  client
    .answer(0)
    .then(() => {
      probes.readyAnswer = "accepted";
      console.log("PROBE ready-answer: ACCEPTED (the server takes answers on QuestionReady)");
    })
    .catch((err) => {
      probes.readyAnswer = "rejected";
      console.log("PROBE ready-answer: REJECTED", JSON.stringify(err));
    });
});

client.on("QuestionStart", (question) => {
  dump("QuestionStart", question);

  const text = question.title ?? question.question ?? null;
  const choices = question.choices ?? null;
  const extensive = question.extensiveMode;

  probes.extensiveModes.add(String(extensive));
  if (typeof text === "string" && text.length > 0) {
    probes.sawTitle = true;
  }
  if (Array.isArray(choices) && choices.length > 0) {
    probes.sawChoices = true;
  }
  probes.restricted = question.questionRestricted === true;

  console.log(`PROBE text field: ${JSON.stringify(text)}`);
  console.log(`PROBE choices field: ${JSON.stringify(choices)}`);
  console.log(`PROBE extensiveMode: ${String(extensive)}`);
  console.log(`PROBE questionRestricted: ${String(question.questionRestricted)}`);
  console.log(`PROBE numberOfChoices: ${String(question.numberOfChoices)}`);
});

client.on("QuestionEnd", (question) => {
  probes.correctChoices = question.correctChoices;
  console.log(
    "correctChoices:",
    JSON.stringify(question.correctChoices),
    "isCorrect:",
    question.isCorrect,
    "choice:",
    JSON.stringify(question.choice),
  );
});

client.on("Disconnect", (reason) => {
  console.log("disconnect:", reason);
  printSummary();
  process.exit(0);
});

/** Frames the library handles, and frames it throws away. */
function analyseFrames() {
  const discarded = [];
  const carryingText = [];

  for (const frame of frames) {
    const id = frame?.data?.id;
    const parsed = contentOf(frame);
    const hasTitle = Boolean(parsed && (typeof parsed.title === "string" || typeof parsed.question === "string"));
    const hasChoices = Boolean(parsed && Array.isArray(parsed.choices) && parsed.choices.length > 0);

    // Only the player channel carries the game data. The bayeux acks and
    // the controller channel would drown the signal.
    if (frame?.channel === "/service/player" && !KNOWN_IDS.has(id)) {
      discarded.push({ id, channel: frame?.channel, hasTitle, hasChoices, parsed });
    }
    if (hasTitle || hasChoices) {
      carryingText.push({ id, channel: frame?.channel, hasTitle, hasChoices });
    }
  }

  return { discarded, carryingText };
}

function printSummary() {
  const { discarded, carryingText } = analyseFrames();

  console.log("\n=== SUMMARY ===");
  console.log(`name accepted      : ${probes.nameAccept ? "yes" : "no NameAccept event"}`);
  console.log(`name renamed       : ${probes.renamed === null ? "unknown" : probes.renamed ? "yes" : "no"}`);
  console.log(`provideControllerExtensiveData: ${probes.gameOptions?.provideControllerExtensiveData ?? "(absent)"}`);
  console.log(`extensiveMode seen : ${[...probes.extensiveModes].join(", ") || "(none)"}`);
  console.log(`title in a question: ${probes.sawTitle ? "yes" : "no"}`);
  console.log(`choices in a question: ${probes.sawChoices ? "yes" : "no"}`);
  console.log(`questionRestricted : ${String(probes.restricted)}  (false either way, it is not a signal)`);
  console.log(`firstGameBlockData : ${describeBlock(probes.firstGameBlockData)}`);
  console.log(`nextGameBlockData  : ${describeBlock(probes.nextGameBlockData)}`);
  console.log(`resend accepted    : ${probes.resend ?? "not tested"}`);
  console.log(`reaction accepted  : ${probes.reaction ?? "not tested (add --react)"}`);
  console.log(`emote accepted     : ${probes.emote ?? "not tested (add --react)"}`);
  console.log(
    `reaction burst     : ${
      probes.burst
        ? `${probes.burst.sent} sent, ${probes.burst.acknowledged} acknowledged, ${probes.burst.rejected} rejected`
        : "not tested (add --react-burst <n>)"
    }`,
  );
  console.log(`ghost answers      : ${probes.ghosts ?? "not tested (add --ghosts)"}`);
  console.log(`ready answer       : ${probes.readyAnswer ?? "not tested (add --ready)"}`);
  console.log(`correctChoices     : ${JSON.stringify(probes.correctChoices)}`);

  console.log(`\nframes received    : ${frames.length}`);
  console.log(`frames discarded by the library: ${discarded.length}`);
  for (const frame of discarded) {
    console.log(
      `  id=${frame.id} channel=${frame.channel} title=${frame.hasTitle} choices=${frame.hasChoices}`,
    );
  }
  console.log(`frames carrying a title or choices: ${carryingText.length}`);
  for (const frame of carryingText) {
    console.log(`  id=${frame.id} channel=${frame.channel} title=${frame.hasTitle} choices=${frame.hasChoices}`);
  }

  if (flags.has("--print-frames")) {
    console.log("\n=== ALL DISCARDED FRAMES, IN FULL ===");
    for (const frame of discarded) {
      console.log(JSON.stringify(frame.parsed, null, 2));
    }
  }
}

function describeBlock(block) {
  if (!block) {
    return "(absent)";
  }
  const choices = Array.isArray(block.choices) ? block.choices : [];
  const filled = choices.filter((choice) => choice && Object.keys(choice).length > 0).length;
  const text = block.title ?? block.question ?? null;
  return `present, ${filled}/${choices.length} choices filled, text=${text ? "yes" : "no"}`;
}

client.join(pin, name).catch((err) => {
  console.error("join failed:", err);
  process.exit(1);
});
