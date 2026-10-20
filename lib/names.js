// Bot name generation.
//
// Kahoot silently rewrites names it considers unsuitable, and the host cannot
// turn that off. The rewrite happens on the way in, so the bot only learns
// about it afterwards via the `NameAccept` event, which reports the name the
// server actually assigned.
//
// The filter matches on substrings, so padding a name at the end does not
// help -- "hello" inside "hello world" still matches. Splitting the word with
// a zero-width character defeats both exact and substring matching, because
// the offending run of characters is no longer contiguous.
//
// Kahoot also truncates names to 15 characters, and that count includes the
// zero-width characters. Everything below stays inside that budget.

export const NAME_MAX_LENGTH = 15;

const INVISIBLE = ["\u200B", "\u200C", "\u200D", "\u2060"];

/**
 * Encode a number as a non-empty run of zero-width characters.
 * Every distinct index gets a distinct run, so the server sees different
 * names while players see the same thing.
 */
export function invisibleSequence(index) {
  let value = index + 1;
  let sequence = "";
  while (value > 0) {
    sequence += INVISIBLE[(value - 1) % INVISIBLE.length];
    value = Math.floor((value - 1) / INVISIBLE.length);
  }
  return sequence;
}

/** Width needed to give `count` bots a distinct zero-width run. */
export function invisibleWidth(count) {
  let width = 1;
  let capacity = INVISIBLE.length;
  while (capacity < count) {
    capacity *= INVISIBLE.length;
    width += 1;
  }
  return width;
}

/**
 * Insert a zero-width run in the middle of the first word of `name`.
 * Falls back to appending when the first word is a single character, where
 * there is no room to split.
 */
export function insertInvisible(name, sequence) {
  const text = String(name ?? "").trim();
  if (!sequence) {
    return text;
  }

  const boundary = text.search(/\s/);
  const word = boundary === -1 ? text : text.slice(0, boundary);
  const rest = boundary === -1 ? "" : text.slice(boundary);

  if (word.length < 2) {
    return `${text}${sequence}`;
  }

  const middle = Math.max(1, Math.floor(word.length / 2));
  return `${word.slice(0, middle)}${sequence}${word.slice(middle)}${rest}`;
}

/** Display name without the zero-width characters -- what a player sees. */
export function visibleName(name) {
  return String(name ?? "")
    .split("")
    .filter((char) => !INVISIBLE.includes(char))
    .join("");
}

/**
 * Parse an `add` argument.
 *
 *   "Player"      -> one bot
 *   "Player*5"    -> five bots with visible numbers 1..5
 *   "Player~5"    -> five bots that all look identical
 *
 * Returns `{ names, error }`.
 */
export function parseNameExpression(raw, { maxBatchSize = 10000 } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { names: [], error: "Invalid add command" };
  }

  const pattern = text.match(/^(.*?)\s*([*~])\s*(\d+)$/);
  if (!pattern) {
    // A '*' or '~' marker with a count we could not read is a mistake.
    // Creating a bot literally called "Player*x" helps nobody.
    if (/^(.*?)\s*[*~]\s*(.*)$/.test(text)) {
      return { names: [], error: "Invalid add command" };
    }
    return { names: [text], error: "" };
  }

  const base = pattern[1].trim();
  const count = Number.parseInt(pattern[3], 10);
  if (!base || !Number.isFinite(count) || count <= 0) {
    return { names: [], error: "Invalid add command" };
  }
  if (count > maxBatchSize) {
    return { names: [], error: "Too many bots requested" };
  }

  if (pattern[2] === "*") {
    const names = [];
    for (let index = 0; index < count; index += 1) {
      const suffix = String(index + 1);
      const room = NAME_MAX_LENGTH - suffix.length;
      names.push(`${base.slice(0, room)}${suffix}`);
    }
    return { names, error: "" };
  }

  // Identical display names: every bot carries a different zero-width run, of
  // the same width so Kahoot truncates them all identically.
  const width = invisibleWidth(count);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    let sequence = "";
    let value = index;
    for (let position = 0; position < width; position += 1) {
      sequence += INVISIBLE[value % INVISIBLE.length];
      value = Math.floor(value / INVISIBLE.length);
    }
    // The zero-width characters count towards the 15 character limit, so the
    // visible part has to give up room for them. Trimming first keeps the
    // sequence inside the limit instead of letting it be cut off, which would
    // make two bots collide on the same name.
    const budget = NAME_MAX_LENGTH - sequence.length;
    names.push(insertInvisible(base.slice(0, budget), sequence));
  }

  return { names, error: "" };
}
