# Kahoot Bot

A fork of [Jones8683/Kahoot-Bot](https://github.com/Jones8683/Kahoot-Bot) with two
additions: it resolves the **correct** answer instead of guessing, and it fires
extra packets to spam the lobby.

The original was a single file that answered at random. This one answers properly
and tells you why.

It also speaks a couple of frames the original library never implemented, because
Kahoot's server accepts them and the library simply never had a class for them.

---

## Install

```bash
npm install
```

Node 18 or newer (the resolver uses the global `fetch`).

---

## Running

```bash
npm start
```

Type a PIN, then add bots.

```
> 12345
> add Bot*100
```

The terminal interface is a live dashboard: bots on the left, a log on the right.

### Commands

| Command | What it does |
|---|---|
| `pin <pin>` | set the game PIN, clear the answer cache, and drop bots still in the old game |
| `add <name>` | add one bot |
| `add <name>*<count>` | add that many bots, numbered `1`, `2`, `3` |
| `add <name>~<count>` | add that many bots that all look identical to a player |
| `kick <name>` | remove one bot |
| `kick all` | remove every bot |
| `mode <perfect\|chaos\|apocalypse\|off>` | choose how bots answer |
| `resend <count>` | extra answer packets per question |
| `react <count>` | reactions per question per bot |
| `model <name>` | change the resolver model without restarting |
| `spam [on\|off\|burst]` | toggle the spam layer, or fire a burst right now |
| `help` | list the commands |
| `exit` | leave the game and quit |

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `RESOLVER_BASE` | -- | any OpenAI-compatible base URL. `/v1/chat/completions` is appended if it is not already there |
| `RESOLVER_KEY` | -- | bearer token. Omit it for a local server that needs no key |
| `RESOLVER_MODEL` | `gpt-4o-mini` | model name passed to the resolver |
| `RESEND` | `0` | extra answer packets per question |
| `FEEDBACK_BURST` | `0` | feedback packets sent when the host asks for feedback |
| `REACTIONS` | `0` | reactions sent per question per bot |
| `PARALLEL` | `35` | joins in flight at once |

```bash
RESOLVER_BASE=http://localhost:11434 RESOLVER_MODEL=llama3.2 npm start
```

---

## How the correct answer is found

This depends on the host's settings, and the bot works out which case it is in
rather than guessing.

**When the host has "Show questions & answers on players' devices" on**, the
question arrives in full: the text in `title`, the options in `choices`. The
bot turns that into a plain question, asks the resolver once for the whole
lobby, and matches the reply back onto an option **by text**, not by position.

Matching on text is the part that matters. Models answer in wildly different
ways:

```
Mercury
The answer is 2.
B) Mercury
The correct answer is Mercury.
```

Text matching survives all four. Parsing an index does not.

It also means it keeps working when Kahoot shuffles the options, which it
does per player.

**When the host has that setting off**, no question text is sent at all. The
player's device renders four coloured buttons and nothing else, so there is
nothing to resolve. The bot says so in the log rather than quietly guessing,
and falls back to:

- **the first question**, which arrives complete with the correct flags on it
  whatever the settings are;
- **answers recorded from an earlier run** of the same quiz.

### The six question types

Kahoot has six kinds of question and each one has to be answered
differently, the same way Kahoot's own client answers them:

| Type | The answer is | What goes on the wire |
|---|---|---|
| `quiz`, `true_false` | one option | `choice: 2` |
| `multiple_select_quiz` | several options | `choice: [0, 3]` |
| `jumble` | an order | `choice: [3, 1, 2, 0]` |
| `open_ended` | the answer as text | `text: "Coral Pink"` |
| `slider` | a number on the slider's step | `choice: 380` |
| `pin_it` | a point on the image | not implemented |

The resolver is asked a different question for each of them: "reply with the
exact text of the correct option" for a quiz, "reply with the correct order,
as the option numbers" for a jumble, "reply with only the number between 0
and 500, in steps of 10" for a slider, and so on.

`pin_it` is the one that is missing. It needs a vision model to look at an
image and pick a point on it, which is a different problem from the rest.

### One call per question, not per bot

150 bots times 20 questions would be 3,000 resolver calls for one game. The
answers are cached by question index, so a game costs 20 calls. Bots that
arrive while a call is in flight wait for it instead of starting another.

### Answers recorded from an earlier run

`QuestionEnd` says which option was right. That is written down, keyed by PIN
and fingerprinted so a different quiz at the same PIN does not inherit it.
Run a quiz once and the next run answers every question from the recording,
with no text and no resolver.

This is the floor that works whatever the host's settings are.

### The answer key, from Kahoot's own API

Kahoot's web client fetches the ghost players' answers from an endpoint that
needs no token and no session:

```
GET https://apis.kahoot.it/gameplay-services/events/v1/game/{gameApiId}/answers
```

Once a game has run a question it holds the answer key, in the same shapes
the client uses. `capture.js --ghosts` reads it. The game id comes from the
`QuizStart` payload, as `gameId`.

This is the most promising route to answering correctly on a first run with
the host's setting off, and it is the one thing still waiting on a game that
is actually running.

### Modes

| Mode | Behaviour |
|---|---|
| `perfect` | resolve the answer and send it once, as fast as the server allows |
| `chaos` | answer at random on purpose |
| `apocalypse` | `perfect`, plus extra packets, feedback bursts, two-factor brute force and auto-reconnect |
| `off` | join, but never answer |

### Challenge pins

A challenge PIN starts with a zero. Challenges are played against Kahoot's own
API rather than a live lobby, and they send the `correct` flag with each
option. When that flag is there the bot uses it directly and skips the resolver
entirely, so challenges work with no API key at all.

Full protocol details, with the captured payloads and the frames Kahoot's own
web client sends, are in [docs/PROTOCOL.md](docs/PROTOCOL.md).

---

## The spam layer

Everything extra repeats **the same answer**, never a different one. If the
server keeps the first answer the repeats change nothing; if it keeps the last
they still land on the right answer. Sending different choices would risk
overwriting a correct one.

- **Extra answer packets.** `resend <count>` repeats the answer a few
  milliseconds apart.
- **Reactions.** `react <count>` sends emoji reactions. The library has no
  class for them, but the server does not care: a reaction is a frame the
  browser sends and the bot can send too. Fifty of them sent as fast as
  possible are all accepted, so the rate limit is the web client's own
  rather than the server's. See
  [docs/PROTOCOL.md](docs/PROTOCOL.md#reactions).
- **Feedback bursts.** When the host asks for feedback, `FEEDBACK_BURST`
  packets are sent back.
- **Two-factor.** Kahoot's two-factor shows four shapes on the host's screen.
  A bot cannot see that screen, so `apocalypse` mode tries the permutations
  until the server accepts one.
- **Auto-reconnect.** In `apocalypse` mode a dropped bot reconnects on its own.

The layer is on by default and can be switched off with `spam off`.

---

## Gotchas

**Names are truncated at 15 characters**, and the count includes the zero-width
characters used to disguise them.

**Kahoot silently renames players it thinks are unsuitable.** The rename
happens on the way in and the host cannot turn it off. The bot detects it
through `NameAccept` and says so in the log.

`add <name>~<count>` puts a zero-width character **inside** the word rather
than at the end. The filter matches on substrings, so appending does not help:
`hello` still appears inside `hello world`. Splitting the word defeats both
exact and substring matching.

Measured against the server:

```
plain                  requested "nigger"       -> "MightyGoose58"    (renamed)
mid-word zero-width    requested "ni<ZWSP>gger"  -> "ni<ZWSP>gger"    (kept)
appended zero-width    requested "nigger<ZWSP>"  -> "HonestGlider14"  (renamed)
```

**If the host hides the questions** ("Show questions & answers on players'
devices" off), there is no text to resolve. The bot falls back to the first
question and to answers recorded from an earlier run, and says so in the log.
Without either of those it is guessing, and it tells you that too.

**A rejected name makes `join()` hang.** Kahoot ignores a login request it
dislikes, and the library never settles the promise it is waiting on. The bot
gives every join a 25 second timeout so one bad name cannot stall a batch.

**Challenge PINs start with a zero**, so the PIN is kept as a string. Turning
`00112233` into the number `112233` turns a challenge into a game that does not
exist.

**Ctrl+C leaves every bot** before exiting, so the lobby does not keep
unkickable ghosts.

---

## Tests

```bash
npm test                  # unit and command tests
npm run test:integration  # joins a real Kahoot challenge and answers it
npm run test:scale        # 150 bots, all connecting and answering
```

The integration and scale tests use a public challenge PIN. A challenge is
played against Kahoot's API rather than a live lobby, so the tests need no
host, no live game and no API key.

```bash
CHALLENGE_PIN=00112233 npm run test:scale
SCALE_BOTS=150 SCALE_PARALLEL=35 npm run test:scale
```

### Tools for a live game

```bash
node capture.js <pin> [name] [--log] [--ready] [--react] [--react-burst 50] [--ghosts] [--recover] [--ua chrome]
node tools/name-probe.mjs <pin>        # what the server calls you
node tools/browser-watch.mjs <pin>     # what a real browser receives
```

`browser-watch.mjs` drives Chrome over the DevTools Protocol and prints every
WebSocket frame the page receives. It is the ground truth for what is on the
wire, and it needs a game that is actually running.

---

## Things worth knowing before you point this at a game

**Your shell disables TLS certificate checking.** `~/.zshenv` sets
`NODE_TLS_REJECT_UNAUTHORIZED=0`, which turns off verification for every HTTPS
request Node makes. That includes the resolver call, which carries your API key.
On an untrusted network that key can be read in transit. Removing the line and
setting it per-command, if a server really needs it, is safer.

**Kahoot's terms of service do not allow bots.** This tool is for your own
quizzes, practice runs, and testing.

---

## Licence

MIT, inherited from the original project. See [LICENSE](LICENSE).
