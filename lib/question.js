// Normalises a raw Kahoot `questionStart` payload into the shape the rest of
// the bot reasons about.
//
// Field names below are not guesses. They come from real captured payloads:
//
//   github.com/manhtruong03/real-time-quiz
//     docs/data_structures/phase2_ws_question_detail.md
//     src/lib/types/websocket-protocol.ts
//
// Live games send the question text in `title` (HTML markup included) and the
// answer options in `choices`, each as `{ answer }` for text options or
// `{ image: { altText } }` for picture options. Live players never receive the
// `correct` flag -- only challenge pins do, via the library's ChallengeHandler.

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

/**
 * Pull the useful bits out of a `questionStart` payload.
 *
 * Returns a plain object; never throws. A payload with no question text (the
 * host turned off "Show questions & answers on players' devices") still
 * returns a usable shape -- just with empty `text` and no `choices`.
 */
export function extractQuestion(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};

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

  return {
    index,
    type,
    text,
    choices,
    numberOfChoices,
    numberOfAnswersAllowed: answersAllowed,
    multiSelect: answersAllowed > 1,
    restricted: raw.questionRestricted === true,
    // Challenge pins ship the correct flag; live games never do.
    correctIndex: choices.findIndex((choice) => choice.correct),
    timeAvailable: Number.isFinite(raw.timeAvailable) ? raw.timeAvailable : null,
  };
}

/** Human-readable summary used in the log panel. */
export function describeQuestion(question) {
  if (!question.text && question.choices.length === 0) {
    return `q${question.index} (no question text)`;
  }
  const preview = question.text.length > 60 ? `${question.text.slice(0, 57)}...` : question.text;
  return `q${question.index} ${preview}`;
}
