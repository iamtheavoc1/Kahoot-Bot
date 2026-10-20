// The ghost answers endpoint.
//
// Kahoot's web client calls it to show what the ghost players answered:
//
//   GET https://apis.kahoot.it/gameplay-services/events/v1/game/{gameApiId}/answers
//
// It needs no token and no session. The response is a list of answer events:
//
//   [{ "event": { "type": "ANSWER", "answerData": { ... } } }]
//
// The answer data is shaped per question type, the same way the client
// builds it:
//
//   { type: "quiz_async",               choiceIndex: 2, isCorrect: true }
//   { type: "multiple_select_quiz_async", selectedChoices: [0, 2], isCorrect: true }
//   { type: "jumble_async",             selectedJumbleOrder: [3, 1, 2, 0], isCorrect: true }
//   { type: "slider_async",             choiceValue: 380, isCorrect: true }
//   { type: "open_ended_async",         text: "Coral Pink", isCorrect: true }
//
// So once a game has been running for a moment, this is the answer key for
// every question answered so far, without the host's setting being on.

export const GHOST_ANSWERS_URL =
  "https://apis.kahoot.it/gameplay-services/events/v1/game/{gameApiId}/answers";

/** The URL for one game. */
export function ghostAnswersUrl(gameApiId) {
  return GHOST_ANSWERS_URL.replace("{gameApiId}", encodeURIComponent(gameApiId));
}

/**
 * Fetch the answer events for a game.
 *
 * Returns an empty array when the game has not run any questions yet.
 * Throws when the endpoint is unhappy.
 */
export async function fetchGhostAnswers(gameApiId, { timeoutMs = 10000 } = {}) {
  const url = ghostAnswersUrl(gameApiId);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`ghost answers ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((entry) => entry?.event ?? entry).filter(Boolean);
}

/**
 * Turn one answer event into the answer itself, in the shape the question
 * type needs.
 */
function answerFromData(data) {
  const type = String(data?.type ?? "");

  if (type.startsWith("multiple_select_quiz")) {
    return Array.isArray(data.selectedChoices) ? data.selectedChoices : null;
  }
  if (type.startsWith("jumble")) {
    return Array.isArray(data.selectedJumbleOrder) ? data.selectedJumbleOrder : null;
  }
  if (type.startsWith("slider")) {
    return Number.isFinite(data.choiceValue) ? data.choiceValue : null;
  }
  if (type.startsWith("open_ended") || type.startsWith("word_cloud")) {
    return typeof data.text === "string" ? data.text : null;
  }
  if (Number.isInteger(data.choiceIndex)) {
    return [data.choiceIndex];
  }
  return null;
}

/**
 * Turn the answer events into a map of question index to the answer.
 *
 * The event carries `originalBlockIndex` and `inGameBlockIndex`; the
 * in-game index is the one that lines up with the question index the bot
 * sees.
 *
 * The answers are in the same shapes Kahoot uses: a list of option indexes
 * for a quiz, a list for a multi-select, a permutation for a jumble, a
 * number for a slider, and text for an open ended question.
 */
export function answersByQuestion(events) {
  const map = new Map();
  for (const entry of events) {
    // The endpoint wraps each event, but a caller may have unwrapped it
    // already.
    const event = entry?.event ?? entry;
    const data = event?.answerData;
    if (!data) {
      continue;
    }

    const index = Number.isInteger(event.inGameBlockIndex)
      ? event.inGameBlockIndex
      : Number.isInteger(event.originalBlockIndex)
        ? event.originalBlockIndex
        : null;
    if (index === null) {
      continue;
    }

    const answer = answerFromData(data);
    if (answer !== null) {
      map.set(index, answer);
    }
  }
  return map;
}
