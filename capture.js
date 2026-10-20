// capture.js -- dump raw packets and settle the open questions in one run.
//
//   node capture.js <pin> [name] [--log] [--ready]
//
//   --log    print every SEND/RECV frame
//   --ready  also probe whether answering on QuestionReady is accepted
//            (off by default: it sends an answer before the question starts,
//            which muddies the resend probe)
//
// The field names printed below are the ones confirmed from real captured
// payloads: the question text is in `title`, the options are in `choices`, and
// each option's text is in `answer` (or `image.altText` for picture options).
// This script is what confirms they hold on a live game.

import Kahoot from "kahoot.js-latest";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const pin = Number(positional[0]);
const name = positional[1] || "capture";

if (!pin) {
  console.error("usage: node capture.js <pin> [name] [--log] [--ready]");
  process.exit(1);
}

const client = new Kahoot();
client.loggingMode = flags.has("--log");

const probes = {
  nameAccept: null,
  renamed: null,
  restricted: null,
  resend: null,
  readyAnswer: null,
  correctChoices: null,
};

const dump = (label, obj) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, null, 2));
  console.log("keys:", Object.keys(obj ?? {}).join(", "));
};

client.on("Joined", (settings) => {
  console.log("settings:", JSON.stringify(settings));
});

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

client.on("QuizStart", (quiz) => dump("QuizStart", quiz));

client.on("QuestionReady", (question) => {
  dump("QuestionReady", question);

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

  probes.restricted = question.questionRestricted === true;
  const text = question.title ?? question.question ?? null;
  const choices = (question.choices ?? []).map((choice) => choice.answer ?? choice.image?.altText ?? null);

  console.log(`PROBE text field: ${JSON.stringify(text)}`);
  console.log(`PROBE choices field: ${JSON.stringify(choices)}`);
  console.log(
    `PROBE restricted: ${probes.restricted ? "TRUE -- the host has 'show questions on players' devices' off" : "false"}`,
  );

  client
    .answer(0)
    .then(() => console.log("PROBE first-answer: accepted"))
    .catch((err) => console.log("PROBE first-answer: REJECTED", JSON.stringify(err)));

  // Probe: is a second packet for the same question accepted or rejected?
  setTimeout(() => {
    client
      .answer(0)
      .then(() => {
        probes.resend = "accepted";
        console.log("PROBE resend-answer: ACCEPTED -- repeating the same answer is a real packet");
      })
      .catch((err) => {
        probes.resend = "rejected";
        console.log("PROBE resend-answer: REJECTED", JSON.stringify(err));
      });
  }, 400);
});

client.on("QuestionEnd", (question) => {
  probes.correctChoices = question.correctChoices;
  console.log("correctChoices:", JSON.stringify(question.correctChoices), "isCorrect:", question.isCorrect);
});

client.on("Disconnect", (reason) => {
  console.log("disconnect:", reason);
  printSummary();
  process.exit(0);
});

function printSummary() {
  console.log("\n=== SUMMARY ===");
  console.log(`name accepted      : ${probes.nameAccept ? "yes" : "no NameAccept event"}`);
  console.log(`name renamed       : ${probes.renamed === null ? "unknown" : probes.renamed ? "yes" : "no"}`);
  console.log(`questions hidden   : ${probes.restricted === null ? "unknown" : probes.restricted ? "yes" : "no"}`);
  console.log(`resend accepted    : ${probes.resend ?? "not tested"}`);
  console.log(`ready answer       : ${probes.readyAnswer ?? "not tested (add --ready)"}`);
  console.log(`correctChoices     : ${JSON.stringify(probes.correctChoices)}`);
}

client.join(pin, name).catch((err) => {
  console.error("join failed:", err);
  process.exit(1);
});
