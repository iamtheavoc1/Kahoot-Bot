// Resolver HTTP tests.
//
//   node test/run.js
//
// Runs a local server that speaks the OpenAI chat completions API, so the
// request and the response are checked without a network or an API key.

import assert from "node:assert/strict";
import http from "node:http";

import { Resolver } from "../lib/resolver.js";
import { extractQuestion } from "../lib/question.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function withServer(handler, run) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      });
      handler(req, res, received);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    return await run(`http://127.0.0.1:${port}`, received);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const QUESTION = extractQuestion({
  type: "quiz",
  gameBlockType: "quiz",
  questionIndex: 0,
  title: "Which planet is closest to the Sun?",
  numberOfChoices: 4,
  numberOfAnswersAllowed: 1,
  choices: [{ answer: "Mercury" }, { answer: "Venus" }, { answer: "Earth" }, { answer: "Mars" }],
});

test("resolver: posts to the chat completions endpoint and reads the reply", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "Mercury" } }] }));
    },
    async (base, received) => {
      const resolver = new Resolver({ base: `${base}/v1`, key: "secret-key", model: "test-model" });
      const reply = await resolver.resolve(QUESTION);

      assert.equal(reply, "Mercury");
      assert.equal(received.length, 1);
      assert.equal(received[0].url, "/v1/chat/completions");
      assert.equal(received[0].method, "POST");
      assert.equal(received[0].headers.authorization, "Bearer secret-key");
      assert.equal(received[0].body.model, "test-model");
      assert.equal(received[0].body.temperature, 0);

      const prompt = received[0].body.messages.at(-1).content;
      assert.match(prompt, /Which planet is closest to the Sun\?/);
      assert.match(prompt, /1\. Mercury/);
      assert.match(prompt, /4\. Mars/);
    },
  );
});

test("resolver: a base without /v1 still works", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "Venus" } }] }));
    },
    async (base, received) => {
      const resolver = new Resolver({ base, model: "test-model" });
      const reply = await resolver.resolve(QUESTION);
      assert.equal(reply, "Venus");
      assert.equal(received[0].url, "/v1/chat/completions");
    },
  );
});

test("resolver: no key means no authorization header", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "Earth" } }] }));
    },
    async (base, received) => {
      const resolver = new Resolver({ base, model: "test-model" });
      await resolver.resolve(QUESTION);
      assert.equal(received[0].headers.authorization, undefined);
    },
  );
});

test("resolver: a server error is raised, not swallowed", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "overloaded" }));
    },
    async (base) => {
      const resolver = new Resolver({ base, model: "test-model" });
      await assert.rejects(() => resolver.resolve(QUESTION), /503/);
    },
  );
});

test("resolver: a question with no text is not sent", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "x" } }] }));
    },
    async (base, received) => {
      const resolver = new Resolver({ base, model: "test-model" });
      const empty = extractQuestion({ type: "quiz", choices: [] });
      assert.equal(await resolver.resolve(empty), null);
      assert.equal(received.length, 0, "nothing was sent");
    },
  );
});

test("resolver: without a base there is nothing to call", async () => {
  const resolver = new Resolver({ base: "" });
  assert.equal(resolver.configured, false);
  assert.equal(await resolver.resolve(QUESTION), null);
});

export { tests };
