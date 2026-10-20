# Kahoot Bot

A fork of [Jones8683/Kahoot-Bot](https://github.com/Jones8683/Kahoot-Bot) with two
additions: it resolves the **correct** answer instead of guessing, and it fires
extra packets to spam the lobby.

The original was a single file that answered at random. This one answers properly
and tells you why.

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
| `PARALLEL` | `35` | joins in flight at once |

```bash
RESOLVER_BASE=http://localhost:11434 RESOLVER_MODEL=llama3.2 npm start
```

---

## How the correct answer is found

1. Kahoot sends the question in the `questionStart` packet: the text is in
   `title`, the options are in `choices`.
2. The bot turns that into a plain question and options.
3. One resolver call per question, shared by every bot in the lobby.
4. The reply is matched back onto an option **by text**, not by position.

The last step is the one that matters. Models answer in wildly different ways:

```
Mercury
The answer is 2.
B) Mercury
The correct answer is Mercury.
```

Matching on text survives all four. Parsing an index does not.

That also means it keeps working when Kahoot shuffles the options, which it
does per player.

Full protocol details, with the captured payloads, are in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

### One call per question, not per bot

150 bots times 20 questions would be 3,000 resolver calls for one game. The
answers are cached by question index, so a game costs 20 calls. Bots that
arrive while a call is in flight wait for it instead of starting another.

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

---

## The spam layer

Everything extra repeats **the same answer**, never a different one. If the
server keeps the first answer the repeats change nothing; if it keeps the last
they still land on the right answer. Sending different choices would risk
overwriting a correct one.

- **Extra answer packets.** `resend <count>` repeats the answer a few
  milliseconds apart.
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

**If the host hides the questions** ("Show questions & answers on players'
devices" off), there is no text to resolve. The bot falls back to guessing.
That looks like a bug and is not one.

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
