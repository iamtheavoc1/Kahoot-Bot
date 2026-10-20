// Normalises Kahoot's question data into the shape the rest of the bot
// reasons about.
//
// There is more than one place the question can turn up, and which one
// carries the text depends on the host's settings:
//
//   QuestionStart            the current question. Carries the text only when
//                            the host has "Show questions & answers on
//                            players' devices" switched on.
//   QuestionReady            carries `nextGameBlockData`, the question that
//                            is coming. With the setting off this is stubbed:
//                            empty choices, no text.
//   QuizStart                carries `firstGameBlockData`, the first question
//                            of the quiz, with the correct flags on it.
//
// So the text can be in any of the three, and the extractor looks in all of
// them.
//
// The discriminator for "is the text there" is `extensiveMode` on the
// question, or `gameOptions.provideControllerExtensiveData` on the game.
// `questionRestricted` is NOT it: it is false either way.

import { createHash } from "node:crypto";

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  hellip: "...",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  middot: "·",
  bull: "•",
  deg: "°",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
};

function fromCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Turn Kahoot's HTML-flavoured strings into plain text.
 * Tags are stripped *before* entities are decoded, so an escaped `&lt;b&gt;`
 * survives as literal text instead of being mistaken for a tag.
 */
export function stripHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  let text = String(value);
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text.replace(/<\/p>/gi, " ");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => fromCodePoint(parseInt(hex, 16)));
  text = text.replace(/&#(\d+);/g, (_, dec) => fromCodePoint(Number(dec)));
  text = text.replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

function choiceText(choice) {
  if (typeof choice === "string") {
    return stripHtml(choice);
  }

  if (!choice || typeof choice !== "object") {
    return "";
  }

  const direct = choice.answer ?? choice.text ?? choice.label ?? choice.altText ?? choice.description;
  if (typeof direct === "string" && direct.trim()) {
    return stripHtml(direct);
  }

  // Picture options carry their label inside the image metadata.
  const nested = choice.image?.altText ?? choice.imageMetadata?.altText ?? choice.media?.altText;
  if (typeof nested === "string" && nested.trim()) {
    return stripHtml(nested);
  }

  return "";
}

function looksLikeQuestion(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (typeof payload.title === "string" || typeof payload.question === "string") {
    return true;
  }
  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    return true;
  }
  return false;
}

/**
 * Find where the question data sits inside a payload.
 *
 * Returns `{ data, carrier }`, where `carrier` is one of `payload`,
 * `nextGameBlockData`, `firstGameBlockData` or `none`.
 */
export function findQuestionData(payload) {
  if (!payload || typeof payload !== "object") {
    return { data: null, carrier: "none" };
  }

  if (looksLikeQuestion(payload)) {
    return { data: payload, carrier: "payload" };
  }

  const next = payload.nextGameBlockData;
  if (next && typeof next === "object" && looksLikeQuestion(next)) {
    return { data: next, carrier: "nextGameBlockData" };
  }

  const first = payload.firstGameBlockData;
  if (first && typeof first === "object" && looksLikeQuestion(first)) {
    return { data: first, carrier: "firstGameBlockData" };
  }

  // The block exists but is empty: that is what a stubbed next question
  // looks like when the host has the questions switched off.
  if (next && typeof next === "object") {
    return { data: next, carrier: "nextGameBlockData" };
  }
  if (first && typeof first === "object") {
    return { data: first, carrier: "firstGameBlockData" };
  }

  return { data: payload, carrier: "none" };
}

/**
 * Pull the useful bits out of a payload that may or may not carry a
 * question.
 *
 * `settings` is the game's join settings. They carry the game wide
 * `gameOptions.provideControllerExtensiveData` flag.
 *
 * Returns a plain object; never throws.
 */
export function extractQuestion(payload, { settings } = {}) {
  const { data, carrier } = findQuestionData(payload);
  const raw = data && typeof data === "object" ? data : {};

  const type = String(raw.gameBlockType || raw.type || "quiz");
  const index = Number.isInteger(raw.questionIndex)
    ? raw.questionIndex
    : Number.isInteger(raw.gameBlockIndex)
      ? raw.gameBlockIndex
      : 0;

  const text = stripHtml(raw.title ?? raw.question ?? raw.text ?? "");

  const choices = Array.isArray(raw.choices)
    ? raw.choices.map((choice) => ({
        text: choiceText(choice),
        correct: Boolean(choice && typeof choice === "object" && choice.correct === true),
        imageId: choice?.image?.id ?? null,
      }))
    : [];

  const numberOfChoices = Number.isInteger(raw.numberOfChoices) ? raw.numberOfChoices : choices.length;
  const answersAllowed = Number.isInteger(raw.numberOfAnswersAllowed) ? raw.numberOfAnswersAllowed : 1;

  // Kahoot's own client reads the slider range off the question payload as
  // minRange / maxRange / step.
  const slider =
    raw.minRange !== undefined || raw.maxRange !== undefined
      ? {
          start: Number(raw.minRange ?? 0),
          end: Number(raw.maxRange ?? 100),
          step: Number(raw.step ?? 1),
          unit: String(raw.unit ?? ""),
        }
      : null;

  // The two flags that say whether the server was willing to send the text.
  const perQuestion = typeof raw.extensiveMode === "boolean" ? raw.extensiveMode : null;
  const perGame =
    settings?.gameOptions?.provideControllerExtensiveData === undefined
      ? null
      : settings.gameOptions.provideControllerExtensiveData === true;

  const extensive = perQuestion === true || perGame === true;
  const questionsHidden = perQuestion === false || perGame === false;

  return {
    index,
    type,
    text,
    choices,
    slider,
    numberOfChoices,
    numberOfAnswersAllowed: answersAllowed,
    multiSelect: answersAllowed > 1,
    // `questionRestricted` is false whether the setting is on or off, so it
    // says nothing. These two do.
    extensive,
    questionsHidden,
    // Where the text was found, for the log.
    carrier,
    hasText: text.length > 0,
    // A stubbed block has the right number of options but none of them say
    // anything, so the count alone does not mean the options are there.
    hasChoices: choices.some((choice) => choice.text.length > 0),
    // Challenge pins ship the correct flag. So does firstGameBlockData.
    correctIndex: choices.findIndex((choice) => choice.correct),
    timeAvailable: Number.isFinite(raw.timeAvailable) ? raw.timeAvailable : null,
  };
}

/**
 * Work out which question index a payload is about.
 *
 * The nested blocks do not always carry an index of their own, so this falls
 * back to the index on the enclosing event.
 */
export function resolveQuestionIndex(payload, question) {
  const carrier = question?.carrier;
  const nested =
    carrier === "nextGameBlockData"
      ? payload?.nextGameBlockData
      : carrier === "firstGameBlockData"
        ? payload?.firstGameBlockData
        : payload;

  if (nested && typeof nested === "object") {
    if (Number.isInteger(nested.questionIndex)) {
      return nested.questionIndex;
    }
    if (Number.isInteger(nested.gameBlockIndex)) {
      return nested.gameBlockIndex;
    }
  }

  if (payload && Number.isInteger(payload.questionIndex)) {
    return payload.questionIndex;
  }
  if (payload && Number.isInteger(payload.gameBlockIndex)) {
    return payload.gameBlockIndex;
  }

  return question?.index ?? 0;
}

/**
 * A stable fingerprint for a quiz, used to tell one quiz from another at the
 * same PIN. Built from the question count and the first question's text when
 * either is known.
 */
export function quizFingerprint({ questionCount, firstQuestionText, quizTitle } = {}) {
  const parts = [String(questionCount ?? ""), String(quizTitle ?? ""), String(firstQuestionText ?? "")];
  if (parts.every((part) => part === "")) {
    return "";
  }
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Human-readable summary used in the log panel. */
export function describeQuestion(question) {
  if (!question.hasText && !question.hasChoices) {
    return `q${question.index} (no question text)`;
  }
  const preview = question.text.length > 60 ? `${question.text.slice(0, 57)}...` : question.text;
  return `q${question.index} ${preview}`;
}

/**
 * The six kinds of question, and how each one has to be answered.
 *
 * Kahoot's own client builds the answer differently for each of these, and
 * so does this bot:
 *
 *   quiz, true_false      one option index
 *   multiple_select_quiz  several option indexes
 *   jumble                an order: a permutation of the four options
 *   open_ended, word_cloud the answer as text
 *   slider                a number in range
 *   pin_it                a point on an image
 */
export const ANSWER_SHAPES = {
  quiz: "index",
  true_false: "index",
  multiple_select_quiz: "indexes",
  jumble: "order",
  open_ended: "text",
  word_cloud: "text",
  slider: "number",
  pin_it: "point",
};

/** Which shape the answer for this question has to take. */
export function answerShapeFor(type) {
  return ANSWER_SHAPES[type] ?? "index";
}

/**
 * The cache key for a question's answer.
 *
 * The type is part of it, because the same index can be answered differently
 * in different games, and a quiz that is played again with different blocks
 * would otherwise pick up the wrong shape.
 */
export function answerCacheKey(question) {
  return `${question.index}:${question.type}`;
}
