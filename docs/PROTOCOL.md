# Kahoot player protocol, as observed

Everything here was confirmed against the library source in
`node_modules/kahoot.js-latest`, against Kahoot's own web client (public
JavaScript at `assets-cdn.kahoot.it/controller/v2/assets/controller-*.js`), and
against live traffic captured from a real game.

Where something is a guess rather than a confirmed fact, it says so.

---

## The important correction

An earlier version of this document said the live `questionStart` payload
carries the question text in `title` and the options in `choices`. **That is
only true when the host has "Show questions & answers on players' devices"
switched on.** With it off, the payload has neither, and a bot that assumes
otherwise silently answers at random.

The payload that `title` and `choices` came from was captured with the setting
on. It is not universal.

### With the setting ON

The full question arrives in `QuestionStart`:

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

### With the setting OFF

Nothing. This is the whole payload:

```json
{
  "gameBlockIndex": 1,
  "totalGameBlockCount": 20,
  "layout": "CLASSIC",
  "extensiveMode": false,
  "type": "quiz",
  "timeRemaining": 19994,
  "timeAvailable": 20000,
  "numberOfAnswersAllowed": 1,
  "currentQuestionAnswerCount": 0,
  "numberOfChoices": 4
}
```

No `title`, no `choices`. The count of options is there, the options are not.
The player's device renders four coloured buttons and nothing else, so there
is no reason to send the text.

### Telling the two apart

| Field | Signal |
|---|---|
| `questionRestricted` | **useless.** False either way. |
| `extensiveMode` | `true` when the server sent the extended data, `false` when it did not |
| `gameOptions.provideControllerExtensiveData` | the game wide version of the same thing |

`questionRestricted` false does not mean the text is there. Use
`extensiveMode`, and `provideControllerExtensiveData` from the game's
`gameOptions` when it is available.

---

## Where the question can turn up

Four places, and which one has the text depends on the settings.

| Carrier | When | What it holds |
|---|---|---|
| `QuestionStart` payload | setting on | the current question, in full |
| `QuizStart.firstGameBlockData` | always | the first question, with the correct flags |
| `QuestionReady.nextGameBlockData` | setting on | the question that is coming |
| `QuestionReady.nextGameBlockData` | setting off | stubbed: `choices: [{},{},{},{}]`, no text |

`firstGameBlockData` is the interesting one. It arrives at the start of the
quiz, it is complete, and each option carries its verdict:

```json
{
  "type": "quiz",
  "questionIndex": 0,
  "title": "Which planet is closest to the Sun?",
  "choices": [
    { "answer": "Mercury", "correct": true },
    { "answer": "Venus", "correct": false },
    { "answer": "Earth", "correct": false },
    { "answer": "Mars", "correct": false }
  ]
}
```

So the first question of a live quiz can be answered perfectly, with no
resolver and no text extraction, whatever the host's settings are.

### Challenges are shaped differently again

A challenge is fetched from `https://kahoot.it/rest/challenges/pin/<pin>` and
played against that API rather than a live lobby. The question is in
**`question`**, not `title`, and every option carries `correct`:

```json
{
  "question": "จิตวิทยา Psychology มีรากศัพท์มาจากภาษาอะไร?",
  "choices": [
    { "answer": "โรมัน", "correct": false },
    { "answer": "กรีก", "correct": true }
  ],
  "type": "quiz",
  "questionIndex": 0,
  "gameBlockType": "quiz"
}
```

### The field names that matter

| What you want | Field | Notes |
|---|---|---|
| the question text | **`title`**, or `question` on a challenge | contains HTML, sometimes `<b>` tags and entities |
| the options | **`choices`** | array, one entry per option |
| an option's text | **`answer`** | or `image.altText` for picture options |
| an option's verdict | **`correct`** | challenge pins and `firstGameBlockData` only |

Picture options carry their label inside the image metadata, which is usually
good enough to answer from.

### The rest of the fields

| Field | Meaning |
|---|---|
| `type` and `gameBlockType` | both present, both the same value: `quiz`, `true_false`, `multiple_select_quiz`, `jumble`, `slider`, `open_ended`, `survey`, `poll`, `content` |
| `questionIndex` | the question's position |
| `gameBlockIndex` | position in the game, sometimes different |
| `numberOfChoices` | how many options there are |
| `numberOfAnswersAllowed` | `1` for single choice, more for multi-select |
| `extensiveMode` | whether the server sent the extended data |
| `timeAvailable` | how long the question is open, in milliseconds |
| `getReadyTimeAvailable` / `getReadyTimeRemaining` | the countdown before the question |
| `image` | the image attached to the question |
| `media` | an array, background images and the like, each with `altText` |

---

## Reactions

**The library has no reaction frame. The server does not care.**

`kahoot.js-latest` is a partial reimplementation of Kahoot's protocol. It has
a class per frame its author needed, and reactions were never one of them.
The server only checks that a well formed frame arrives on the socket.

The frame was read out of Kahoot's own web client, which is public
JavaScript. The client maps every game server code to a number:

```js
// assets-cdn.kahoot.it/controller/v2/assets/controller-*.js
submitReaction: defineControllerMessage()(SUBMIT_REACTION, 47),
submitEmote:    defineControllerMessage()(SUBMIT_EMOTE, 48),
```

and publishes it like this:

```js
this.publishMessage(cometd, {
  gameid: pin,
  type: PublishType.Message,
  host: host,
  id: gameServerCode,
  content: JSON.stringify(data)
}, channel)
```

So a reaction is exactly:

```json
{
  "gameid": "562917",
  "host": "kahoot.it",
  "id": 47,
  "type": "message",
  "content": "{\"reactionType\":\"ThumbsUp\"}"
}
```

on `/service/controller`. Identical in shape to the answer frame the library
already sends.

**Verified live.** Against a real game, `ThumbsUp`, `Clap` and `Heart` were
all accepted and acknowledged with a server timetrack.

The reaction types are `ThumbsUp`, `Clap`, `Heart`, `Haha`, `Wow`, `Thinking`,
`Popper`, `Trophy`, `Flame` and `Victory`. Emotes are `Heart`, `Trophy` and
`Victory`, on code 48 with an `emoteType` field.

### Rate limiting

Kahoot's own client counts **five reactions inside ten seconds** as spam and
starts penalising the player for it:

```js
updateAntiSpamState = (state, timestamp, {punishSpamCount = 5, punishSpamTimeWindow = 10000} = {}) => {
  const timestamps = [...state.timestamps, timestamp].slice(-5);
  const spam = timestamps.length === 5 && timestamp - timestamps[0] < 10000;
  ...
}
```

**That throttle is the web client's own, not a server rule.** Fifty reactions
sent as fast as possible were all acknowledged by the server, none dropped:

```
PROBE reaction burst: 50 sent in 2919ms, 50 acknowledged, 0 rejected
```

A hundred bots each sending one is nowhere near the limit.

### Emotes

`submitEmote` is code **48** with an `emoteType` field instead of
`reactionType`, and it is a separate primitive rather than a reaction with a
different value. The types are `Heart`, `Trophy` and `Victory`. Verified
accepted live.

### The whole game server code table

From the same source. The library's own codes cross-check against it:

| Code | Action | In the library? |
|---|---|---|
| 4 | `CLAIM_PAINT_WAR_TILE` | no |
| 6 | `POTENTIAL_GAME_BLOCK_ANSWER` | no |
| 11 | `SUBMIT_FEEDBACK` | yes, `LiveFeedbackPacket` |
| 16 | `REQUEST_RECOVERY_DATA_FROM_PLAYER` | yes, `LiveRequestData` |
| 18 | `JOIN_TEAM_MEMBERS` | yes, `LiveJoinTeamPacket` |
| 31 | `RENAME_COLLABORATION` | no |
| 32 | `CHOOSE_COLLABORATION` | no |
| 42 | `SUBMIT_ANSWER_VOTE` | no |
| 45 | `GAME_BLOCK_ANSWER` | yes, `LiveQuestionAnswer` |
| **47** | **`SUBMIT_REACTION`** | **no** |
| **48** | **`SUBMIT_EMOTE`** | **no** |
| 50 | `SUBMIT_TWO_FACTOR` | yes, `LiveTwoStepAnswer` |
| 61 | `SUBMIT_TAP_TO_COLLECT_POINTS` | no |
| 65 | `REVEAL_PICASSO_FRAGMENTS` | no |
| 71 | `SUBMARINE_SUBMIT_BOOST` | no |
| 73 | `SUBMARINE_CONTROLLER_HEARTBEAT` | no |
| 74 | `SUBMARINE_SUBMIT_COOP_PHASE_ANSWER` | no |
| 81 | `SUBMARINE_SUBMIT_QUIZ_ANSWER` | no |
| 92 | `SET_ALL_ANSWERS_SUBMITTED_STATUS` | no |
| 103 | `REQUEST_TEMPLE_CONFIDENCE` | no |
| 116 | `SUBMIT_WALKING_CONTROLLER_GAME_DATA` | no |

Anything the browser can send, the bot can send. The library's silence is a
statement about somebody's 2023 code, not about what Kahoot accepts.

---

## The answer shapes

Each question type is answered differently, and Kahoot's own client is where
the shapes come from. It builds the answer payload per type:

```js
// the client bundle, gameApiAnswerBasePayload
case GameBlockType.Quiz:
  return {type: `${GameBlockType.Quiz}_async`, choiceIndex: o, isCorrect: a === "correct"};
case GameBlockType.Slider:
  return {type: `${GameBlockType.Slider}_async`, choiceValue: o, isCorrect: a === "correct"};
case GameBlockType.OpenEnded:
  return {type: `${GameBlockType.OpenEnded}_async`, text: o, isCorrect: a === "correct"};
case GameBlockType.MultipleSelectQuiz:
  return {type: `${GameBlockType.MultipleSelectQuiz}_async`, selectedChoices: o, isCorrect: a === "correct"};
case GameBlockType.Jumble:
  return {type: `${GameBlockType.Jumble}_async`, selectedJumbleOrder: o, isCorrect: a === "correct"};
case GameBlockType.PinIt:
  return {type: `${GameBlockType.PinIt}_async`, pin: o, isCorrect: a === "correct"};
```

So:

| Type | Answer | What the bot sends |
|---|---|---|
| `quiz`, `true_false` | one option index | `choice: 2` |
| `multiple_select_quiz` | several option indexes | `choice: [0, 3]` |
| `jumble` | a permutation of the options | `choice: [3, 1, 2, 0]` |
| `open_ended`, `word_cloud` | the answer as text | `text: "Coral Pink"` |
| `slider` | a number on the slider's step | `choice: 380` |
| `pin_it` | a point on the image | not implemented |

`LiveQuestionAnswer` already understands all of these shapes. The bot just
has to produce the right one, which means the resolver has to be asked a
different question for each type.

### The slider range

Kahoot's client reads the slider range off the question payload:

```js
slider: t.type === GameBlockType.Slider
  ? {unit: t.unit, start: t.minRange, end: t.maxRange, step: t.step}
  : undefined
```

So the fields are `minRange`, `maxRange`, `step` and `unit`.

### The jumble order

The client shows the options in the order the player sees them and the
answer is a permutation of those positions. It works out which permutations
are valid by grouping the options that share a value, then checks the
answer against them:

```js
getValidJumbleAnswers = (choices) => { ... generatePermutations ... }
verifyJumbleAnswer = (answer, choices, order) => {
  const valid = getValidJumbleAnswers(choices).map(...);
  const distances = valid.map(v => v.filter((x, i) => answer?.[i] !== x).length);
  return {isCorrect: distances[minIndex(distances)] === 0, mostCorrectAnswer: valid[minIndex(distances)]};
}
```

So the answer is the order the options should be in, expressed as positions
in the shuffled list.

---

## The ghost answers endpoint

Kahoot's web client calls this to show what the ghost players answered:

```
GET https://apis.kahoot.it/gameplay-services/events/v1/game/{gameApiId}/answers
```

**No token, no session, no cookie.** Verified reachable: `200` with an empty
list for a game that has not run a question yet.

The response is a list of answer events:

```json
[{ "event": {
  "type": "ANSWER",
  "nickname": "...",
  "originalBlockIndex": 0,
  "inGameBlockIndex": 0,
  "answerData": { "type": "quiz_async", "choiceIndex": 2, "isCorrect": true }
}}]
```

The `answerData` is shaped exactly as the table above, so once a game has run
a question this is the answer key for it, whatever the host's setting is and
without a resolver.

The `gameApiId` comes from the `QuizStart` payload, as `gameId`.

The endpoints under `report/v1` are the host's, and answer `401` to a
player:

```
GET /gameplay-services/report/v1/data/{gameId}/blocks      401
GET /gameplay-services/report/v1/data/{gameId}/answers     401
GET /gameplay-services/leaderboard/v1/game/{gameId}        401
```

---

From the library source. Anything else arrives on the socket and is
discarded:

```
1 questionReady    2 questionStart    3 quizEnd       4 timeOver
5 gameReset        8 questionEnd      9 quizStart    10 twoFactorCorrect
12 feedback       13 podium         14 nameAccept   17 recovery
19 teamAccept     20 teamTalk       51 twoFactorReset  52 twoFactorWrong
53 twoFactorReset
```

Seen on the wire but not handled: **200**, which is
`{"controllerEstimateCount": 10}` and only says how many players the lobby
expects.

The acknowledgement for any frame is routed by the bayeux message id, so a
frame the library has no class for still gets a reply:

```js
this.handlers.timetrack = (message) => {
  if (this.waiting[message.id]) {
    this.waiting[message.id](message);
    delete this.waiting[message.id];
  }
};
```

---

## Packet ids the library handles

From the library source. Anything else arrives on the socket and is
discarded:

```
1 questionReady    2 questionStart    3 quizEnd       4 timeOver
5 gameReset        8 questionEnd      9 quizStart    10 twoFactorCorrect
12 feedback       13 podium         14 nameAccept   17 recovery
19 teamAccept     20 teamTalk       51 twoFactorReset  52 twoFactorWrong
53 twoFactorReset
```

Seen on the wire but not handled: **200**, which is
`{"controllerEstimateCount": 10}` and only says how many players the lobby
expects.

The acknowledgement for any frame is routed by the bayeux message id, so a
frame the library has no class for still gets a reply:

```js
this.handlers.timetrack = (message) => {
  if (this.waiting[message.id]) {
    this.waiting[message.id](message);
    delete this.waiting[message.id];
  }
};
```

---

## The other events

| Event | Server message | Payload |
|---|---|---|
| `QuestionReady` | `/service/player` id `1` | `questionIndex`, `gameBlockType`, `timeLeft`, and `nextGameBlockData` |
| `QuestionStart` | `/service/player` id `2` | the current question, above |
| `QuestionEnd` | `/service/player` id `8` | `correctChoices`, `isCorrect`, `points`, `rank`, `pointsData`, `nemesis` |
| `NameAccept` | `/service/player` id `14` | `playerName`, `quizType`, `playerV2` |
| `Feedback` | `/service/player` id `12` | `quizType` |
| `TwoFactorReset` / `Wrong` / `Correct` | ids `53` / `51` / `52` | fired by `src/modules/main.js` |

### `correctChoices`

On a live game it is populated, even for a single choice question: `[3]`,
`[0]`, `[1]` were all observed. That makes it usable to record which answer
was right.

In **challenge** mode the library builds that event itself and only fills
`correctChoices` inside the `multiple_select_quiz` branch, so for an ordinary
challenge question it is always `[]` even though `isCorrect` is correct. Use
`isCorrect` when checking a challenge.

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

**Repeating an answer works.** A second `answer()` for the same question is
accepted by the server, confirmed live. That is what makes the spam layer
possible.

**`join()` can hang forever.** From `Documentation.md`:

> There is a chance that this may neither resolve nor reject if Kahoot! for
> some reason decides to ignore your login request (usually due to a suspicious
> name).

Reproduced. A challenge rejects a nickname it has already seen, and the
library handles that like this:

```js
this._httpRequest(`.../join/?nickname=${encodeURIComponent(this.name)}`, {method:"POST"}, true)
  .then((data)=>{
    if(data.error){ throw data; }
    joined(this.cid);
  })
  .catch(()=>{
    this.leave("Error connecting to Challenge");
  });
```

The error is swallowed, the socket closes, and the promise `join()` is waiting
on is never settled. The bot wraps every join in a 25 second timeout for this
reason.

In a live game the same situation arrives as a rejected promise with
`description: "Duplicate name"`, and the library deliberately does *not* leave
the socket in that case, which is how a rejected name turns into a ghost.

**`NameAccept` is where the name filter shows up.** The library sets
`this.name = data.playerName` before emitting, so comparing that against the
name you asked for tells you whether Kahoot rewrote it. It does: a name the
filter dislikes comes back as a generated nickname like `SoaringSnail56`,
not a censored spelling of what was asked for.

**The name filter is defeated by splitting the word, not by padding it.**
Measured against the server:

```
plain                  requested "nigger"       -> "MightyGoose58"    (renamed)
mid-word zero-width    requested "ni<ZWSP>gger"  -> "ni<ZWSP>gger"    (kept)
appended zero-width    requested "nigger<ZWSP>"  -> "HonestGlider14"  (renamed)
```

The filter matches on substrings, so a zero-width character inside the word
means the offending run is no longer contiguous and the name passes
untouched. A zero-width character appended at the end does not help at all:
the word is still there in one piece. This is why `lib/names.js` puts the
character in the middle of the first word.

**The user agent is a random string.** The library does
`this.userAgent = ua.getRandom()` and puts it in the login packet as
`device.userAgent`. It can claim to be the W3C CSS validator. Kahoot decides
what to send from that string, so it is worth overriding with a real browser
user agent. `--ua chrome` does that.

---

## Getting the game state

The protocol has one request for "tell me the state of the game", and it is
not the one you would guess:

```
POST /service/controller   id 16   REQUEST_RECOVERY_DATA_FROM_PLAYER
```

The answer comes back on the player channel as id `17`, and the library maps
its `state` onto events:

```js
case 1: this._emit("QuizStart", data); break;
case 2: this._emit("QuestionReady", data.getReady); break;
case 3: this._emit("QuestionStart", data); break;
case 4:
case 5:
  this._emit("TimeUp", data);
  if (data.revealAnswer) this._emit("QuestionEnd", data.revealAnswer);
  break;
```

So the recovery payload at state 3 *is* the question, and at states 4 and 5
it carries `revealAnswer`, which has the correct choices in it.

This is the game's own view of itself rather than the player's view, and it
exists to put a disconnected player back in the game. So it may well carry
the question whatever the host's "show questions" setting is.

`capture.js --recover` polls it every two seconds and prints any recovery
that carries a title or choices.

---

## Still unverified

- Whether the ghost answers endpoint holds the answer key for a game that has
  only just started. It is reachable and it is empty before the first
  question; what comes back afterwards needs a game that is actually
  running.
- Whether `nextGameBlockData` carries the full question, with the correct
  flags, when the setting is on. If it does, live games need no resolver at
  all, the same as challenges.
- Whether a real user agent changes `extensiveMode` to `true` and makes the
  text appear with the setting off.
- Whether answering on `QuestionReady` is accepted.
- What `provideControllerExtensiveData` looks like in the game settings. It
  is absent from the `Joined` payload, so it may only ever appear in
  `QuizStart`.
- Whether a reaction actually renders on the host's screen. The server
  acknowledges the frame, which is not the same thing, and that needs
  somebody watching the host's display.

`capture.js` probes all of these:

```bash
node capture.js <pin> [name] [--log] [--ready] [--react] [--react-burst <n>] [--ghosts] [--ua chrome] [--print-frames]
```

It prints the raw payload, the field names, every frame the library throws
away, and a summary of each probe.
