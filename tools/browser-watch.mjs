// Watch what a real browser receives from Kahoot, over the DevTools Protocol.
//
//   node tools/browser-watch.mjs <pin> [name]
//
// The browser is the ground truth. If the question text arrives when the
// host has "Show questions & answers on players' devices" off, then the data
// is on the wire and the library is simply throwing it away. If it does not
// arrive, the setting is a hard gate.
//
// No Playwright needed: Chrome is driven over the DevTools Protocol, which
// is all it takes to see the WebSocket frames the page receives.
//
// Needs a game that is actually running. A finished game answers "We didn't
// recognize that game PIN".

import { spawn } from "node:child_process";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9336;
const PROFILE = "/private/var/folders/44/wflxxzzx4g5gwd7k3_45jkwc0000gn/T/opencode/chrome-profile4";
const SHOT = "/private/var/folders/44/wflxxzzx4g5gwd7k3_45jkwc0000gn/T/opencode/page.png";

const KNOWN = new Set([1, 2, 3, 4, 5, 8, 9, 10, 12, 13, 14, 17, 19, 20, 51, 52, 53]);

const pin = process.argv[2];
const name = process.argv[3] || `bw${Date.now().toString(36).slice(-6)}`;
if (!pin) {
  console.error("usage: node browser-watch.mjs <pin> [name]");
  process.exit(1);
}

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    // Do not look like a robot.
    `--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36`,
    "--window-size=1280,900",
  ],
  { stdio: "ignore" },
);
process.on("exit", () => {
  try {
    chrome.kill("SIGKILL");
  } catch {
    /* gone */
  }
});

let version = null;
for (let attempt = 0; attempt < 60 && !version; attempt += 1) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch {
    await sleep(300);
  }
}
if (!version) {
  throw new Error("chrome did not start");
}

const ws = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  ws.on("open", resolve);
  ws.on("error", reject);
});

let nextId = 1;
const pending = new Map();
let sessionId = null;
const frames = [];

function send(method, params = {}, useSession = true) {
  const id = nextId++;
  const message = { id, method, params };
  if (useSession && sessionId) {
    message.sessionId = sessionId;
  }
  ws.send(JSON.stringify(message));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result?.result?.value;
}

/** Set an input's value the way a framework expects to see it. */
const FILL = `(selector, value) => {
  const el = document.querySelector(selector);
  if (!el) return "no input: " + selector;
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", {bubbles: true}));
  el.dispatchEvent(new Event("change", {bubbles: true}));
  return "ok";
}`;

ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
    return;
  }

  if (message.method === "Network.webSocketFrameReceived") {
    const payload = message.params.response.payloadData;
    frames.push(payload);
    let parsed = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const id = item?.data?.id;
      if (typeof id !== "number") continue;
      let content = item?.data?.content;
      if (typeof content === "string") {
        try {
          content = JSON.parse(content);
        } catch {
          /* leave it */
        }
      }
      const isObject = content && typeof content === "object";
      const hasTitle = isObject && typeof content.title === "string";
      const hasChoices = isObject && Array.isArray(content.choices);
      if (hasTitle || hasChoices) {
        console.log(`\n*** FRAME WITH QUESTION DATA, id=${id}`);
        console.log(JSON.stringify(content, null, 2).slice(0, 2500));
      } else if (!KNOWN.has(id)) {
        console.log(`unknown frame id=${id} keys=${isObject ? Object.keys(content).join(",") : "?"}`);
      }
    }
  }
});

const target = await send("Target.createTarget", { url: "about:blank" }, false);
const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false);
sessionId = attached.sessionId;

await send("Network.enable");
await send("Page.enable");
await send("Runtime.enable");

await send("Page.navigate", { url: "https://kahoot.it/join" });
await sleep(4000);

// The PIN screen.
console.log("filling the pin");
await evaluate(`(${FILL})("input", ${JSON.stringify(pin)})`);
await sleep(400);
await evaluate(
  `[...document.querySelectorAll("button")].find(b => /join/i.test(b.innerText))?.click() ?? "no join button"`,
);
await sleep(4000);

// The name screen.
const pageState = await evaluate(
  `JSON.stringify({url: location.href, text: (document.body?.innerText||'').slice(0,300), inputs: [...document.querySelectorAll("input")].map(i => i.getAttribute("data-functional-selector") || i.id || i.name || i.type)})`,
);
console.log("after pin:", pageState);

console.log("filling the name");
await evaluate(`(${FILL})("input", ${JSON.stringify(name)})`);
await sleep(400);
await evaluate(
  `[...document.querySelectorAll("button")].find(b => /ok|join|go/i.test(b.innerText))?.click() ?? "no ok button"`,
);
await sleep(6000);

const joined = await evaluate(
  `JSON.stringify({url: location.href, text: (document.body?.innerText||'').slice(0,300)})`,
);
console.log("after name:", joined);

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot?.data) {
  fs.writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
  console.log("screenshot written");
}

// Watch for the game.
for (let tick = 0; tick < 240; tick += 1) {
  await sleep(1000);
  const withQuestion = frames.filter((f) => f.includes('"title"') || f.includes('"choices"'));
  if (withQuestion.length > 0) {
    console.log(`\n=== ${withQuestion.length} frames carry question data ===`);
    console.log(withQuestion[withQuestion.length - 1].slice(0, 2500));
    break;
  }
}

console.log(`\ntotal frames: ${frames.length}`);
const ids = new Set();
for (const f of frames) {
  try {
    for (const item of JSON.parse(f)) {
      if (typeof item?.data?.id === "number") ids.add(item.data.id);
    }
  } catch {
    /* ignore */
  }
}
console.log(`ids seen: ${[...ids].sort((a, b) => a - b).join(", ")}`);

ws.close();
chrome.kill("SIGKILL");
process.exit(0);
