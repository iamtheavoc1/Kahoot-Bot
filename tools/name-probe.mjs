// Does the mid-word zero-width run defeat Kahoot's name filter?
//
//   node name-probe.mjs <pin>
//
// The filter matches on substrings, so a name with a zero-width character
// inside the word should not contain the offending run at all. This checks
// what the server actually calls us, for a plain name and for the same name
// split in the middle.

import Kahoot from "kahoot.js-latest";

const pin = process.argv[2];
if (!pin) {
  console.error("usage: node name-probe.mjs <pin>");
  process.exit(1);
}

const ZWSP = "\u200B";

const CASES = [
  { label: "plain", name: "nigger" },
  { label: "mid-word zero-width", name: `ni${ZWSP}gg` + "er" },
  { label: "appended zero-width", name: `nigger${ZWSP}` },
  { label: "clean name", name: `probe${Date.now().toString(36).slice(-5)}` },
];

for (const testCase of CASES) {
  const result = await new Promise((resolve) => {
    const client = new Kahoot();
    const timer = setTimeout(() => resolve({ outcome: "timed out" }), 20000);

    client.on("NameAccept", (info) => {
      clearTimeout(timer);
      const assigned = String(info?.playerName ?? "");
      resolve({
        outcome: "joined",
        requested: testCase.name,
        assigned,
        changed: assigned !== testCase.name,
        visible: assigned.split("").filter((c) => !"\u200B\u200C\u200D\u2060".includes(c)).join(""),
      });
      try {
        client.leave(true);
      } catch {
        /* ignore */
      }
    });

    client.on("Disconnect", (reason) => {
      clearTimeout(timer);
      resolve({ outcome: `disconnected: ${reason}` });
    });

    client.join(pin, testCase.name).catch((err) => {
      clearTimeout(timer);
      resolve({ outcome: "join failed", detail: String(err?.description ?? err?.message ?? err) });
    });
  });

  const shown = JSON.stringify(result.requested ?? "").replace(/\\u200b/g, "<ZWSP>");
  console.log(`${testCase.label.padEnd(22)} requested ${shown}`);
  console.log(`  ${JSON.stringify(result)}`);
}
