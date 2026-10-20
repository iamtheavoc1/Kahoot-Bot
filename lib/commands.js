// The command layer.
//
// Kept apart from the terminal interface so that every command can be
// exercised without a TTY. `index.js` owns the screen; this owns the
// behaviour.

import { parsePin } from "./config.js";
import { MODES } from "./bots.js";
import { parseNameExpression } from "./names.js";

const MAX_BATCH_SIZE = 10000;

export function createCommands({ manager, config, log, refresh, onExit }) {
  const error = (message) => log("err", message);

  function showHelp() {
    log("info", [
      "Commands:",
      "  pin <pin>                      set the PIN and clear the answer cache",
      "  add <name>                    add one bot",
      "  add <name>*<count>            add count bots, numbered",
      "  add <name>~<count>            add count bots with identical display names",
      "  kick <name>                   remove one bot",
      "  kick all                      remove every bot",
      "  mode <perfect|chaos|apocalypse|off>",
      "  resend <count>                extra answer packets per question",
      "  react <count>                 reactions per question per bot",
      "  model <name>                  resolver model",
      "  spam [on|off|burst]           toggle spam, or fire a burst now",
      "  help",
      "  exit",
    ].join("\n"));
  }

  function handlePin(tokens) {
    if (tokens.length !== 1) {
      error("Invalid PIN");
      return;
    }

    const pin = parsePin(tokens[0]);
    if (!pin) {
      error("Invalid PIN");
      return;
    }

    if (pin === config.pin) {
      log("info", `PIN already ${pin}`);
      return;
    }

    // Bots are joined to the old game, and the answer cache belongs to it.
    manager.kickAll();
    manager.setPin(pin);
    log("ok", `PIN set to ${pin}`);
    refresh();
  }

  async function handleAdd(argument) {
    if (!config.pin) {
      error("Set a PIN before adding bots");
      return;
    }

    const parsed = parseNameExpression(argument, { maxBatchSize: MAX_BATCH_SIZE });
    if (parsed.error) {
      error(parsed.error);
      return;
    }

    await manager.addBots(parsed.names);
    refresh();
  }

  function handleKick(tokens, argument) {
    if (tokens.length === 1 && tokens[0].toLowerCase() === "all") {
      manager.kickAll();
      log("info", "All bots removed");
      refresh();
      return;
    }

    if (tokens.length === 0) {
      error("kick requires a bot name");
      return;
    }

    if (!manager.kick(argument)) {
      error("Bot not found");
      return;
    }
    refresh();
  }

  function handleMode(tokens) {
    if (tokens.length !== 1) {
      error(`mode requires one of: ${MODES.join(", ")}`);
      return;
    }

    const mode = tokens[0].toLowerCase();
    if (!MODES.includes(mode)) {
      error(`Unknown mode. Use one of: ${MODES.join(", ")}`);
      return;
    }

    config.mode = mode;
    log("ok", `Mode set to ${mode}`);
    refresh();
  }

  function handleResend(tokens) {
    if (tokens.length !== 1) {
      error("resend requires a count");
      return;
    }

    const count = Number.parseInt(tokens[0], 10);
    if (!Number.isFinite(count) || count < 0) {
      error("resend requires a non-negative count");
      return;
    }

    config.resend = count;
    log("ok", `Resend set to ${count}`);
    refresh();
  }

  function handleModel(tokens) {
    if (tokens.length !== 1) {
      error("model requires a name");
      return;
    }

    manager.setModel(tokens[0]);
    log("ok", `Model set to ${config.model}`);
    refresh();
  }

  function handleReact(tokens) {
    if (tokens.length !== 1) {
      error("react requires a count");
      return;
    }

    const count = Number.parseInt(tokens[0], 10);
    if (!Number.isFinite(count) || count < 0) {
      error("react requires a non-negative count");
      return;
    }

    config.reactions = count;
    log("ok", `Reactions set to ${count} per question`);
    refresh();
  }

  function handleSpam(tokens) {
    if (tokens.length === 0) {
      config.spamEnabled = !config.spamEnabled;
      log("ok", `Spam ${config.spamEnabled ? "enabled" : "disabled"}`);
      refresh();
      return;
    }

    const action = tokens[0].toLowerCase();
    if (action === "on") {
      config.spamEnabled = true;
      log("ok", "Spam enabled");
    } else if (action === "off") {
      config.spamEnabled = false;
      log("ok", "Spam disabled");
    } else if (action === "burst") {
      manager.burstSpam();
    } else {
      error("spam takes on, off or burst");
      return;
    }
    refresh();
  }

  /** Handle one line of input. */
  async function handle(text) {
    const clean = String(text ?? "").trim();
    if (!clean) {
      return;
    }

    const [command, ...tokens] = clean.split(/\s+/);
    const name = command.toLowerCase();
    const argument = tokens.join(" ");

    switch (name) {
      case "exit":
      case "quit":
        await onExit();
        return;
      case "help":
        showHelp();
        return;
      case "pin":
        handlePin(tokens);
        return;
      case "add":
        await handleAdd(argument);
        return;
      case "kick":
        handleKick(tokens, argument);
        return;
      case "mode":
        handleMode(tokens);
        return;
      case "resend":
        handleResend(tokens);
        return;
      case "model":
        handleModel(tokens);
        return;
      case "react":
        handleReact(tokens);
        return;
      case "spam":
        handleSpam(tokens);
        return;
      default:
        break;
    }

    // Before a PIN is set, a bare number is treated as the PIN.
    if (!config.pin) {
      const pin = parsePin(name);
      if (pin) {
        manager.setPin(pin);
        log("ok", `PIN set to ${pin}`);
        refresh();
        return;
      }
    }

    error("Unknown command. Run help to list commands");
  }

  return { handle, showHelp };
}
