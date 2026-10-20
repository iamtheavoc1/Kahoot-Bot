// Bot lifecycle and the answering engine.
//
// One `Kahoot` client per bot. The clients are dumb: each one receives the
// same question at the same moment, and the shared AnswerCache makes sure the
// expensive part (asking a model) happens once per question rather than once
// per bot.

import Kahoot from "kahoot.js-latest";

import { AnswerCache } from "./answer-cache.js";
import {
  answerCacheKey,
  answerShapeFor,
  describeQuestion,
  extractQuestion,
  quizFingerprint,
  resolveQuestionIndex,
} from "./question.js";
import { KnownAnswers } from "./known-answers.js";
import { answersByQuestion, fetchGhostAnswers } from "./ghost-answers.js";
import { Resolver, parseAnswer } from "./resolver.js";
import { SAFE_INTERVAL_MS, randomReaction, sendReaction } from "./reaction.js";
import { visibleName } from "./names.js";

const JOIN_TIMEOUT_MS = 25000;
const TWO_FACTOR_ORDER = [0, 1, 2, 3];

export const MODES = ["perfect", "chaos", "apocalypse", "off"];

/**
 * Fill the gaps in one question with what another payload knows.
 * The QuestionStart payload and the cached block data each know some of it.
 */
function mergeQuestions(primary, fallback) {
  if (!fallback) {
    return primary;
  }
  if (primary.hasText && primary.hasChoices) {
    return primary;
  }
  if (fallback.hasText && fallback.hasChoices) {
    return fallback;
  }

  const choices = primary.hasChoices ? primary.choices : fallback.choices;
  return {
    ...primary,
    text: primary.text || fallback.text,
    choices,
    hasText: Boolean(primary.text || fallback.text),
    hasChoices: choices.length > 0,
    correctIndex: primary.correctIndex !== -1 ? primary.correctIndex : fallback.correctIndex,
    carrier: primary.carrier === "none" ? fallback.carrier : primary.carrier,
  };
}

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
  constructor({ config, log, onQuestionEnd, resolver, knownAnswers } = {}) {
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
    // Answers recorded from an earlier run of the same quiz.
    this.known = knownAnswers ?? new KnownAnswers();
    // The game's join settings, which carry the game wide gameOptions.
    this.settings = null;
    // Question data seen in QuizStart and QuestionReady, by question index.
    this.questions = new Map();
    // Identifies the quiz, so a recording is not reused for a different one.
    this.fingerprint = "";
    // The answer key from Kahoot's public endpoint, when there is one.
    this.gameApiId = "";
    this.ghostAnswers = new Map();
    this.ghostTimer = null;
    this.shuttingDown = false;
    this.renamesReported = 0;
    this.reportedHidden = false;
  }

  setPin(pin) {
    if (pin === this.config.pin) {
      return false;
    }
    this.config.pin = pin;
    // Answers are cached per question index, so the cache belongs to a game.
    this.cache.clear();
    this.questions.clear();
    this.fingerprint = "";
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
      currentQuestionIndex: null,
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
        this.log("warn", `${bot.displayName}: join timed out, the name was most likely rejected`);
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

    client.on("Joined", (settings) => {
      // The join settings carry the game wide gameOptions, including
      // provideControllerExtensiveData.
      this.settings = settings ?? this.settings;
      const extensive = this.settings?.gameOptions?.provideControllerExtensiveData;
      if (extensive === false) {
        this.log("warn", "host has 'show questions & answers on players' devices' off: no text to resolve");
      }
    });

    client.on("QuizStart", (payload) => {
      // firstGameBlockData is the first question of the quiz, complete with
      // the correct flags on it.
      this._rememberQuestion(payload);
      this._fingerprintFrom(payload);
      this._startGhostPolling(payload?.gameId);
    });

    client.on("QuestionReady", (payload) => {
      // nextGameBlockData is the question that is coming. With the host's
      // setting off it arrives stubbed: empty choices, no text.
      this._rememberQuestion(payload);
    });

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
      this._recordAnswer(bot, payload);
      this.onQuestionEnd(bot, payload);
    });

    client.on("GameReset", () => {
      // The host pressed "play again" or moved on to the next quiz. Question
      // indices start from zero again, so the cached answers are stale.
      this.cache.clear();
      this.questions.clear();
      this.log("info", "game reset, answer cache cleared");
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

  /**
   * Poll Kahoot's public answer key.
   *
   * The endpoint needs no token and no session, and it holds the answer
   * events for a game. It is empty for a game that has not run a question
   * yet, so this is a bonus rather than a dependency: if it has nothing,
   * the bot carries on as before.
   */
  _startGhostPolling(gameApiId) {
    if (!gameApiId || this.ghostTimer) {
      return;
    }
    this.gameApiId = gameApiId;

    const poll = async () => {
      try {
        const events = await fetchGhostAnswers(gameApiId);
        const answers = answersByQuestion(events);
        if (answers.size > this.ghostAnswers.size) {
          this.ghostAnswers = answers;
          this.log("info", `answer key: ${answers.size} questions known`);
        }
      } catch {
        /* the endpoint may be unhappy, or the game may be over */
      }
    };

    poll();
    this.ghostTimer = setInterval(poll, 2000);
    this.ghostTimer.unref?.();
  }

  /**
   * Keep the question data that turns up in QuizStart and QuestionReady.
   * The block data may be complete even when the QuestionStart payload is
   * not, so it is worth holding on to.
   */
  _rememberQuestion(payload) {
    const question = extractQuestion(payload, { settings: this.settings });
    if (question.carrier === "none") {
      return;
    }

    const index = resolveQuestionIndex(payload, question);
    const existing = this.questions.get(index);
    this.questions.set(index, existing ? mergeQuestions(question, existing) : question);
  }

  /** Identify the quiz, so a recording is not reused for a different quiz. */
  _fingerprintFrom(payload) {
    const first = this.questions.get(0) ?? extractQuestion(payload, { settings: this.settings });
    const questionCount =
      payload?.gameBlockCount ??
      payload?.questionCount ??
      (Array.isArray(payload?.quizQuestionAnswers) ? payload.quizQuestionAnswers.length : undefined);

    this.fingerprint = quizFingerprint({
      questionCount,
      firstQuestionText: first?.text ?? "",
      quizTitle: payload?.name ?? payload?.quizTitle ?? "",
    });
  }

  /**
   * Remember which option was correct. `QuestionEnd` carries the correct
   * indexes for a live game; on a challenge it does not, but the answer's own
   * verdict does.
   */
  _recordAnswer(bot, payload) {
    const index = bot.currentQuestionIndex;
    if (index === null || index === undefined) {
      return;
    }

    let correct = null;
    if (Array.isArray(payload?.correctChoices) && payload.correctChoices.length > 0) {
      correct = payload.correctChoices;
    } else if (payload?.isCorrect === true && typeof bot.lastChoice === "number") {
      correct = [bot.lastChoice];
    }

    if (!correct) {
      return;
    }
    this.known.record(this.config.pin, this.fingerprint, index, correct);
  }

  async _onQuestionStart(bot, payload) {
    const payloadQuestion = extractQuestion(payload, { settings: this.settings });
    const index = resolveQuestionIndex(payload, payloadQuestion);

    // The QuestionStart payload may be empty while the block data we saw
    // earlier is not. Use whichever knows more.
    const question = mergeQuestions(payloadQuestion, this.questions.get(index));

    bot.lastQuestion = question;
    bot.currentQuestionIndex = index;

    if (this.config.mode === "off") {
      return;
    }

    if (question.questionsHidden && !question.hasText && !this.reportedHidden) {
      this.reportedHidden = true;
      this.log(
        "warn",
        "the host has the questions hidden, so there is no text to resolve: answers will be guesses",
      );
    }

    const choice = await this._chooseAnswer(question);
    if (choice === null || choice === undefined) {
      return;
    }

    bot.lastChoice = choice;
    this._sendAnswer(bot, choice);

    if (this.config.reactions > 0 && this.config.spamEnabled) {
      this._reactionBurst(bot);
    }
  }

  /**
   * Fire off some reactions.
   *
   * They are spaced out, because Kahoot's own client counts five reactions
   * inside ten seconds as spam and starts penalising the player. One bot
   * sending a few will not trip it; a hundred bots each sending one will
   * cover the host's screen, which is the point.
   */
  _reactionBurst(bot) {
    for (let index = 0; index < this.config.reactions; index += 1) {
      setTimeout(() => {
        sendReaction(bot.client, randomReaction()).catch(() => {});
      }, index * SAFE_INTERVAL_MS);
    }
  }

  /**
   * Work out what to answer.
   *
   * Order matters:
   *   1. Chaos mode answers at random on purpose, even where the answer is
   *      known.
   *   2. An answer recorded from an earlier run of this quiz is exact and
   *      free.
   *   3. The payload sometimes carries the correct flag, so no model is
   *      needed.
   *   4. Otherwise ask the resolver, once for the whole lobby.
   *
   * The answer comes back in the shape the question type needs: one index,
   * several indexes, an order, some text, or a number.
   */
  async _chooseAnswer(question) {
    if (this.config.mode === "chaos") {
      // Chaos means random, even where the answer is known.
      return this._randomChoice(question);
    }

    const recorded = this.known.get(this.config.pin, this.fingerprint, question.index);
    if (recorded) {
      return recorded.length === 1 ? recorded[0] : recorded;
    }

    if (question.correctIndex !== -1) {
      // The payload carries the correct flag. Challenges always do, and so
      // does firstGameBlockData.
      return question.correctIndex;
    }

    // Kahoot's public answer key, if it knows this question.
    const ghost = this.ghostAnswers.get(question.index);
    if (ghost !== undefined) {
      return ghost.length === 1 ? ghost[0] : ghost;
    }

    const answer = await this._resolveAnswer(question);
    if (answer === null || answer === undefined) {
      return this._randomChoice(question);
    }

    return answer;
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

    const shape = answerShapeFor(question.type);
    const needsOptions = shape === "index" || shape === "indexes" || shape === "order";
    if (!question.text || (needsOptions && !question.hasChoices)) {
      // The host has questions hidden. Fall back to guessing rather than
      // pretending we can do better.
      return null;
    }

    const key = answerCacheKey(question);

    try {
      return await this.cache.get(key, async () => {
        const reply = await this.resolver.resolve(question);
        const answer = parseAnswer(question, reply);
        this.log("info", `resolved ${describeQuestion(question)}`);
        if (answer === null || answer === undefined) {
          this.log("warn", `could not use the reply for ${describeQuestion(question)}, guessing`);
        }
        return answer;
      });
    } catch (err) {
      this.log("err", `resolver failed: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * A guess, in the shape the question type needs.
   *
   * Random is as good as anything for most of these, but the shape still
   * has to be right: a jumble needs a permutation, a slider needs a number
   * on its step, a multi-select needs a list.
   */
  _randomChoice(question) {
    const shape = answerShapeFor(question.type);
    const count = question.choices.length || question.numberOfChoices || 4;

    if (shape === "order") {
      if (count === 0) {
        return null;
      }
      const order = Array.from({ length: count }, (_, index) => index);
      for (let index = order.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [order[index], order[swap]] = [order[swap], order[index]];
      }
      return order;
    }

    if (shape === "number") {
      const slider = question.slider;
      if (!slider) {
        return null;
      }
      const steps = Math.max(0, Math.round((slider.end - slider.start) / (slider.step || 1)));
      const step = Math.floor(Math.random() * (steps + 1));
      const decimals = (String(slider.step ?? 1).split(".")[1] ?? "").length;
      return Number((slider.start + step * (slider.step || 1)).toFixed(decimals));
    }

    if (shape === "text") {
      return "";
    }

    if (shape === "point") {
      return null;
    }

    if (count <= 0) {
      return null;
    }

    if (shape === "indexes") {
      const wanted = Math.min(question.numberOfAnswersAllowed || 1, count);
      const picks = [];
      while (picks.length < wanted) {
        const pick = Math.floor(Math.random() * count);
        if (!picks.includes(pick)) {
          picks.push(pick);
        }
      }
      return picks;
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
    if (this.ghostTimer) {
      clearInterval(this.ghostTimer);
      this.ghostTimer = null;
    }
    this.kickAll();
    this.known.flush();
    await sleep(700);
  }
}
