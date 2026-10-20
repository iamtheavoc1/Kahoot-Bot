# Kahoot player protocol, as observed

Everything here was confirmed against the library source in
`node_modules/kahoot.js-latest`, against captured payloads from
[manhtruong03/real-time-quiz](https://github.com/manhtruong03/real-time-quiz)
(`docs/data_structures/phase2_ws_question_detail.md` and
`src/lib/types/websocket-protocol.ts`), and against a live Kahoot challenge
(`https://kahoot.it/rest/challenges/pin/00112233`).

Where something is a guess rather than a confirmed fact, it says so.

---

## The one thing that matters: `questionStart`

The library does not touch the payload, it just parses it:

```js
// src/modules/questionStart.js
this.handlers.questionStart = (message) => {
  if (message.channel === "/service/player" && message.data && message.data.id === 2) {
    this.questionStartTime = Date.now();
    this._emit("QuestionStart", JSON.parse(message.data.content));
  }
};
```

So the event object *is* the raw server payload. This is a real one, captured
from a live game:

```json
{
  "gameBlockIndex": 5,
  "totalGameBlockCount": 15,
  "title": "Which of the below is one thing quantum computers <b>can't</b> do?",
  "video": { "startTime": 0, "endTime": 0, "service": "youtube", "fullUrl": "" },
  "image": "https://media.kahoot.it/37defd0-4652-4c2f-a5a8-f0c5f8f28c2c",
  "media": [],
  "type": "quiz",
  "timeRemaining": 29998,
  "timeAvailable": 30000,
  "numberOfAnswersAllowed": 1,
  "currentQuestionAnswerCount": 0,
  "pointsMultiplier": 1,
  "numberOfChoices": 4,
  "choices": [
    { "answer": "Help us search for Earth-like planets" },
    { "answer": "Break mainstream cryptosystems used for data security" },
    { "answer": "Potentially cure Alzheimer’s disease" },
    { "answer": "Replace world leaders" }
  ],
  "questionRestricted": false,
  "getReadyTimeAvailable": 6600,
  "getReadyTimeRemaining": 6600,
  "questionIndex": 5,
  "gameBlockType": "quiz"
}
```

### The two fields that matter

| What you want | Field | Notes |
|---|---|---|
| the question text | **`title`** | contains HTML, sometimes `<b>` tags and entities |
| the options | **`choices`** | array, one entry per option |

Each entry in `choices` is one of:

```json
{ "answer": "the option text" }
```

```json
{ "image": { "id": "...", "altText": "swiss flag", "contentType": "image/jpeg" } }
```

Picture options have no text of their own. Their label lives in
`image.altText`, which is often good enough to answer from.

### The rest of the fields

| Field | Meaning |
|---|---|
| `type` and `gameBlockType` | both present, both the same value: `quiz`, `true_false`, `multiple_select_quiz`, `jumble`, `slider`, `open_ended`, `survey`, `poll`, `content` |
| `questionIndex` | the question's position, also the cache key |
| `gameBlockIndex` | position in the game, sometimes different |
| `numberOfChoices` | how many options there are |
| `numberOfAnswersAllowed` | `1` for single choice, more for multi-select |
| `questionRestricted` | `true` when the host has questions hidden |
| `timeAvailable` | how long the question is open, in milliseconds |
| `timeRemaining` | time left when the packet was sent |
| `getReadyTimeAvailable` / `getReadyTimeRemaining` | the countdown before the question |
| `image` | the image attached to the question |
| `media` | an array, background images and the like, each with `altText` |
| `video` | video metadata |

### Variants

**Jumble.** Same shape, `choices` hold the tiles in shuffled order.

**Open ended.** Has a `title` but no `choices` at all. There is nothing to
match against, so the answer has to be typed.

**Survey.** Looks like a quiz, but it is not scored.

**Content.** A slide between questions, with a `description` and no options.

### Live games never send the correct flag

`choices` entries in a live game are `{"answer": "..."}` and nothing else. The
`correct` boolean only appears on challenge pins. That is why a live game
needs a resolver and a challenge does not.

---

## Challenge payloads are shaped differently

A challenge is fetched from `https://kahoot.it/rest/challenges/pin/<pin>` and
played against that API, not against a live lobby. The question is in
**`question`**, not `title`, and each option carries its verdict:

```json
{
  "question": "จิตวิทยา Psychology มีรากศัพท์มาจากภาษาอะไร?",
  "time": 20000,
  "pointsMultiplier": 1,
  "choices": [
    { "answer": "โรมัน", "correct": false },
    { "answer": "กรีก", "correct": true },
    { "answer": "โบราณ", "correct": false },
    { "answer": "ไทย", "correct": false }
  ],
  "type": "quiz",
  "questionIndex": 0,
  "gameBlockType": "quiz",
  "timeAvailable": 20000
}
```

The library's `ChallengeHandler` merges this into the same `QuestionStart`
event, so one extractor covers both. It reads `title` first and `question`
second, and it looks for `correct` on every option.

**A challenge PIN starts with a zero.** Keep the PIN as a string. `Number("00112233")`
is `112233`, which is a different, non-existent game.

---

## The other events

| Event | Server message | Payload |
|---|---|---|
| `QuestionReady` | `/service/player` id `1` | `questionIndex`, `gameBlockType`, `timeLeft`. **No question text.** |
| `QuestionStart` | `/service/player` id `2` | the full question, above |
| `QuestionEnd` | `/service/player` id `8` | `correctChoices`, `isCorrect`, `points`, `rank`, `pointsData`, `nemesis` |
| `NameAccept` | `/service/player` id `14` | `playerName`, `quizType`, `playerV2` |
| `Feedback` | `/service/player` id `12` | `quizType` |
| `TwoFactorReset` / `TwoFactorWrong` / `TwoFactorCorrect` | `/service/player` id `14`-ish | fired by the two-factor handler in `src/modules/main.js` |

`QuestionReady` carries no text, so there is nothing to answer early. The
earliest moment an answer can be sent is `QuestionStart`, and the library
already waits 250 ms after it before sending.

### `correctChoices` is only populated for multi-select

In a live game the server sends `correctChoices: [1]` for a single-choice
question. In **challenge** mode the library builds that event itself and only
fills `correctChoices` inside the `multiple_select_quiz` branch, so for an
ordinary challenge question it is always `[]` even though `isCorrect` is
correct. Use `isCorrect`, not `correctChoices`, when checking a challenge.

---

## Method notes

**`answer()` rejects after 10 seconds.** Each call sends its own message and
waits for its own receipt, with the timeout in `_send`:

```js
setTimeout(() => {
  if (this.waiting[id]) {
    callback(null);   // the answer() promise rejects on a null result
    delete this.waiting[id];
  }
}, 10e3);
```

So calling it twice does not overwrite the first call's receipt slot. Whether
the *server* accepts a second answer for the same question is a different
question, and one that only a live game can answer. `capture.js` probes it.

**`join()` can hang forever.** From `Documentation.md`:

> There is a chance that this may neither resolve nor reject if Kahoot! for
> some reason decides to ignore your login request (usually due to a suspicious
> name).

The bot wraps every join in a 25 second timeout for this reason.

**A duplicate name rejects** with `description: "duplicate name"`, and the
library deliberately does *not* leave the socket in that case, which is how a
rejected name turns into a ghost.

**`NameAccept` is where the filter shows up.** The library sets
`this.name = data.playerName` before emitting, so comparing that against the
name you asked for tells you whether Kahoot rewrote it.

---

## What is still unverified

These need a live game with a host, and are what `capture.js` is for:

- does the server accept a second `answer()` for the same question, or reject it?
- does answering on `QuestionReady` get accepted?
- what does the payload look like when the host has "Show questions & answers on
  players' devices" off? (`questionRestricted` is the field to watch)
- does the profanity filter apply to bot joins, and does `NameAccept` fire for
  them?

```bash
node capture.js <pin> [name] [--log] [--ready]
```

It prints the raw payload, the field names, and a summary of each probe.
