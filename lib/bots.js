// Bot lifecycle and the answering engine.
//
// One `Kahoot` client per bot. The clients are dumb: each one receives the
// same question at the same moment, and the shared AnswerCache makes sure the
// expensive part (asking a model) happens once per question rather than once
// per bot.

import Kahoot from "kahoot.js-latest";

import { AnswerCache } from "./answer-cache.js";
import { describeQuestion, extractQuestion } from "./question.js";
import { Resolver, matchChoice, matchChoices } from "./resolver.js";
import { visibleName } from "./names.js";

const JOIN_TIMEOUT_MS = 25000;
const TWO_FACTOR_ORDER = [0, 1, 2, 3];

export const MODES = ["perfect", "chaos", "apocalypse", "off"];

function permutations(items) {
  if (items.length <= 1) {
    return [items];
  }
  const result = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) {
      result.push([items[index], ...tail]);
    }
  }
  return result;
}

const TWO_FACTOR_PERMUTATIONS = permutations(TWO_FACTOR_ORDER);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BotManager {
  constructor({ config, log, onQuestionEnd, resolver }) {
    this.config = config;
    this.log = log;
    this.onQuestionEnd = onQuestionEnd ?? (() => {});
    this.bots = new Map();
    this.cache = new AnswerCache();
    // The resolver can be swapped for any OpenAI-compatible endpoint, and
    // replaced outright in tests.
    this.resolver =
      resolver ??
      new Resolver({
        base: config.resolverBase,
        key: config.resolverKey,
        model: config.model,
      });
    this.shuttingDown = false;
    this.renamesReported = 0;
  }

  setPin(pin) {
    if (pin === this.config.pin) {
      return false;
    }
    this.config.pin = pin;
    // Answers are cached per question index, so the cache belongs to a game.
    this.cache.clear();
    return true;
  }

  setModel(model) {
    this.config.model = model;
    this.resolver.setModel(model);
  }

  /** Names of the bots currently in the lobby, as a player would see them. */
  activeNames() {
    return Array.from(this.bots.values())
      .filter((bot) => bot.status === "active")
      .map((bot) => bot.displayName)
      .reverse();
  }

  /**
   * Join `names` to the current PIN, at most `parallel` joins in flight.
   * Above roughly 35 the server starts refusing connections.
   */
  async addBots(names) {
    if (!this.config.pin) {
      this.log("err", "Set a PIN before adding bots");
      return;
    }
    if (names.length === 0) {
      this.log("warn", "No bot names provided");
      return;
    }

    const workers = Math.max(1, Math.min(this.config.parallel, names.length));
    let cursor = 0;

    const runWorker = async () => {
      while (cursor < names.length) {
        const name = names[cursor];
        cursor += 1;
        await this._connectBot(name);
      }
    };

    await Promise.all(Array.from({ length: workers }, runWorker));
  }

  async _connectBot(name) {
    const client = new Kahoot();
    const bot = {
      name,
      displayName: visibleName(name),
      client,
      status: "joining",
      pendingKick: false,
      mutedDisconnect: false,
      twoFactorSolved: false,
      lastChoice: null,
      lastQuestion: null,
    };

    this.bots.set(bot, bot);
    this._wire(bot);

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("join timed out")), JOIN_TIMEOUT_MS);
    });

    try {
      // Promise.race keeps the dangling join promise from becoming an
      // unhandled rejection when the timeout wins.
      await Promise.race([client.join(this.config.pin, name), timeout]);
    } catch (err) {
      clearTimeout(timer);
      this.bots.delete(bot);
      const description = String(err?.description ?? err?.message ?? err);
      if (/duplicate name/i.test(description)) {
        this.log("warn", `${bot.displayName}: name already in use`);
      } else if (/timed out/i.test(description)) {
        this.log("warn", `${bot.displayName}: join timed out (name likely rejected)`);
      } else {
        this.log("err", `${bot.displayName}: failed to join (${description})`);
      }
      try {
        client.leave(true);
      } catch {
        /* the socket may never have opened */
      }
      return;
    }
    clearTimeout(timer);

    if (bot.pendingKick) {
      bot.mutedDisconnect = true;
      this.bots.delete(bot);
      try {
        client.leave(true);
      } catch {
        /* ignore */
      }
      this.log("info", `${bot.displayName} removed`);
      return;
    }

    bot.status = "active";
    this.log("ok", `${bot.displayName} connected`);
  }

  _wire(bot) {
    const client = bot.client;

    client.on("NameAccept", (info) => {
      const assigned = String(info?.playerName ?? "");
      if (!assigned) {
        return;
      }
      if (assigned !== bot.name) {
        // Kahoot rewrote the name: the profanity filter, or the 15 character
        // truncation. Either way the server's name is the one that counts.
        bot.displayName = visibleName(assigned);
        this.renamesReported += 1;
        if (this.renamesReported <= 5) {
          this.log("warn", `${bot.displayName}: renamed by Kahoot (filter or length)`);
        } else if (this.renamesReported === 6) {
          this.log("warn", "further renames suppressed");
        }
      }
    });

    client.on("QuestionStart", (payload) => {
      this._onQuestionStart(bot, payload).catch((err) => {
        this.log("err", `answer failed: ${err?.message ?? err}`);
      });
    });

    client.on("QuestionEnd", (payload) => {
      this.onQuestionEnd(bot, payload);
    });

    client.on("Feedback", () => {
      this._feedbackBurst(bot).catch(() => {});
    });

    client.on("TwoFactorReset", () => {
      bot.twoFactorSolved = false;
      this._solveTwoFactor(bot).catch(() => {});
    });

    client.on("TwoFactorCorrect", () => {
      bot.twoFactorSolved = true;
      this.log("ok", `${bot.displayName}: passed two-factor`);
    });

    client.on("Disconnect", (reason) => {
      this._onDisconnect(bot, reason);
    });
  }

  async _onQuestionStart(bot, payload) {
    const question = extractQuestion(payload);
    bot.lastQuestion = question;

    if (this.config.mode === "off") {
      return;
    }

    const choice = await this._chooseAnswer(question);
    if (choice === null || choice === undefined) {
      return;
    }

    bot.lastChoice = choice;
    this._sendAnswer(bot, choice);
  }

  /**
   * Work out what to answer.
   *
   * Order matters:
   *   1. Challenge pins ship the correct flag, so no model is needed.
   *   2. Chaos mode answers at random on purpose.
   *   3. Otherwise ask the resolver, once for the whole lobby.
   */
  async _chooseAnswer(question) {
    const texts = question.choices.map((choice) => choice.text);

    if (this.config.mode === "chaos") {
      // Chaos means random, even where the answer is known.
      return this._randomChoice(question);
    }

    if (question.correctIndex !== -1) {
      // Challenge pins ship the correct flag, so no model is needed.
      return question.correctIndex;
    }

    const reply = await this._resolveAnswer(question);
    if (reply === null) {
      return this._randomChoice(question);
    }

    if (question.multiSelect) {
      const picks = matchChoices(reply, texts);
      return picks.length > 0 ? picks : this._randomChoice(question);
    }

    const index = matchChoice(reply, texts);
    return index === -1 ? this._randomChoice(question) : index;
  }

  /** One resolver call per question, shared by every bot in the lobby. */
  async _resolveAnswer(question) {
    if (!this.resolver.configured) {
      if (!this.warnedNoResolver) {
        this.warnedNoResolver = true;
        this.log("warn", "no resolver configured, answers will be guesses (set RESOLVER_BASE)");
      }
      return null;
    }
    if (!question.text || question.choices.length === 0) {
      // The host has questions hidden. Fall back to guessing rather than
      // pretending we can do better.
      return null;
    }

    try {
      return await this.cache.get(question.index, async () => {
        const reply = await this.resolver.resolve(question);
        this.log("info", `resolved ${describeQuestion(question)}`);
        return reply;
      });
    } catch (err) {
      this.log("err", `resolver failed: ${err?.message ?? err}`);
      return null;
    }
  }

  _randomChoice(question) {
    const count = question.choices.length || question.numberOfChoices || 4;
    if (count <= 0) {
      return null;
    }
    return Math.floor(Math.random() * count);
  }

  /**
   * Send the answer, then the spam copies.
   *
   * The copies repeat the *same* choice on purpose. If the server keeps the
   * first answer, the repeats change nothing; if it keeps the last, they
   * still land on the right answer. Sending different choices would risk
   * overwriting a correct one.
   */
  _sendAnswer(bot, choice) {
    const client = bot.client;
    const send = () => {
      Promise.resolve(client.answer(choice)).catch(() => {});
    };

    send();

    if (!this.config.spamEnabled) {
      return;
    }

    const extra = Math.max(0, this.config.resend);
    for (let index = 0; index < extra; index += 1) {
      setTimeout(send, 5 + index * 3);
    }
  }

  /** Fire an extra round of packets at the question currently on screen. */
  burstSpam() {
    let sent = 0;
    for (const bot of this.bots.values()) {
      if (bot.status !== "active" || bot.lastChoice === null) {
        continue;
      }
      const choice = bot.lastChoice;
      const client = bot.client;
      Promise.resolve(client.answer(choice)).catch(() => {});
      sent += 1;
    }
    this.log("ok", `spam burst sent to ${sent} bots`);
  }

  async _feedbackBurst(bot) {
    if (!this.config.spamEnabled || this.config.feedbackBurst <= 0) {
      return;
    }
    for (let index = 0; index < this.config.feedbackBurst; index += 1) {
      try {
        await bot.client.sendFeedback(5, 1, 1, 1);
      } catch {
        // Challenges refuse feedback, and the server may refuse bursts.
        return;
      }
    }
  }

  /**
   * Two-factor shows four shapes on the host's screen. A bot cannot see that
   * screen, so it tries the permutations until the server accepts one.
   */
  async _solveTwoFactor(bot) {
    if (!this.config.spamEnabled || this.config.mode !== "apocalypse") {
      return;
    }

    for (const permutation of TWO_FACTOR_PERMUTATIONS) {
      if (bot.twoFactorSolved || this.shuttingDown) {
        return;
      }
      try {
        await bot.client.answerTwoFactorAuth(permutation);
      } catch {
        return;
      }
      await sleep(120);
    }
  }

  _onDisconnect(bot, reason) {
    if (bot.pendingKick || bot.mutedDisconnect) {
      this.bots.delete(bot);
      return;
    }

    if (this.config.mode === "apocalypse" && !this.shuttingDown && this.config.pin) {
      bot.status = "reconnecting";
      this.log("warn", `${bot.displayName}: dropped, reconnecting`);
      this._reconnect(bot).catch(() => {});
      return;
    }

    this.bots.delete(bot);
    this.log("warn", `${bot.displayName} disconnected (${reason})`);
  }

  async _reconnect(bot) {
    await sleep(500);
    try {
      await bot.client.reconnect();
      bot.status = "active";
      this.log("ok", `${bot.displayName} reconnected`);
    } catch (err) {
      this.bots.delete(bot);
      this.log("err", `${bot.displayName}: reconnect failed (${err?.message ?? err})`);
    }
  }

  kick(name) {
    const target = String(name ?? "").trim();
    if (!target) {
      return false;
    }

    const bot = Array.from(this.bots.values())
      .reverse()
      .find((entry) => entry.name === target || entry.displayName === target);

    if (!bot) {
      return false;
    }

    if (bot.status === "joining" || bot.status === "reconnecting") {
      bot.pendingKick = true;
      this.bots.delete(bot);
      this.log("info", `${bot.displayName} removed`);
      return true;
    }

    bot.mutedDisconnect = true;
    this.bots.delete(bot);
    this._leave(bot);
    this.log("info", `${bot.displayName} removed`);
    return true;
  }

  kickAll() {
    for (const bot of Array.from(this.bots.values())) {
      if (bot.status === "joining" || bot.status === "reconnecting") {
        bot.pendingKick = true;
        this.bots.delete(bot);
        continue;
      }
      bot.mutedDisconnect = true;
      this.bots.delete(bot);
      this._leave(bot);
    }
  }

  _leave(bot) {
    try {
      bot.client.leave(true);
    } catch {
      this.log("warn", `${bot.displayName} could not be removed cleanly`);
    }
  }

  /** Leave every bot and give the packets a moment to reach the server. */
  async shutdown() {
    this.shuttingDown = true;
    this.kickAll();
    await sleep(700);
  }
}
