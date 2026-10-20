import blessed from "blessed";

import { BotManager } from "./lib/bots.js";
import { loadConfig } from "./lib/config.js";
import { createCommands } from "./lib/commands.js";

const HEADER_COLOR = "magenta";
const STATUS_STYLES = {
  info: { symbol: "[i]", color: "cyan" },
  ok: { symbol: "[+]", color: "green" },
  warn: { symbol: "[!]", color: "yellow" },
  err: { symbol: "[x]", color: "red" },
};

const config = loadConfig();

let inputBuffer = "";
let cursorIndex = 0;
let inputScroll = 0;
let shuttingDown = false;
const commandHistory = [];
let historyIndex = -1;
let historySavedInput = "";
let commandQueue = Promise.resolve();

const PANEL_OPTIONS = {
  tags: true,
  padding: { left: 1, right: 1 },
  border: { type: "line" },
};
const SCROLL_OPTIONS = {
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  scrollbar: { bg: "gray" },
};

const screen = blessed.screen({
  smartCSR: true,
  title: "Kahoot Bot Manager",
  cursor: {
    artificial: false,
    shape: "line",
    blink: true,
  },
});

function createPanel(type, options) {
  return blessed[type]({
    ...PANEL_OPTIONS,
    ...options,
  });
}

const header = createPanel("box", {
  top: 0,
  left: 0,
  width: "100%",
  height: 3,
  content: "{bold}Kahoot Bot Manager{/bold}",
  style: {
    fg: HEADER_COLOR,
    bg: "#1f1230",
    border: { fg: HEADER_COLOR },
    label: { fg: HEADER_COLOR, bold: true },
  },
});

const botsBox = createPanel("box", {
  top: 3,
  left: 0,
  width: "35%",
  bottom: 3,
  ...SCROLL_OPTIONS,
  label: " Active Bots ",
  content: "(none)",
  style: {
    fg: "white",
    bg: "#2d2a10",
    border: { fg: "yellow" },
    label: { fg: "yellow", bold: true },
  },
});

const logsBox = createPanel("log", {
  top: 3,
  left: "35%",
  width: "65%",
  bottom: 3,
  ...SCROLL_OPTIONS,
  label: " Logs ",
  style: {
    fg: "white",
    bg: "#3d3410",
    border: { fg: "yellow" },
    label: { fg: "yellow", bold: true },
  },
});

const inputBox = createPanel("box", {
  bottom: 0,
  left: 0,
  width: "100%",
  height: 3,
  label: " Input ",
  style: {
    fg: "white",
    bg: "#0f2e13",
    border: { fg: "green" },
    label: { fg: "green", bold: true },
  },
});

screen.append(header);
screen.append(botsBox);
screen.append(logsBox);
screen.append(inputBox);

function currentPrompt() {
  return config.pin ? "CMD> " : "PIN> ";
}

function setCursorVisible(visible) {
  if (visible) {
    screen.program.showCursor();
  } else {
    screen.program.hideCursor();
  }
}

function renderHeader() {
  const resolver = config.resolverBase || "not set";
  header.setContent(
    [
      "{bold}Kahoot Bot Manager{/bold}",
      `PIN {bold}${config.pin || "-"}{/bold}   mode {bold}${config.mode}{/bold}   spam {bold}${config.spamEnabled ? "on" : "off"}{/bold}   resend {bold}${config.resend}{/bold}   model {bold}${config.model}{/bold}   resolver {bold}${resolver}{/bold}`,
    ].join("\n"),
  );
}

function renderInput() {
  const prompt = currentPrompt();
  const chars = Array.from(inputBuffer);
  const totalWidth = Math.max(1, (inputBox.width || 1) - 4);
  const promptChars = Array.from(prompt).length;
  const fieldWidth = Math.max(1, totalWidth - promptChars);

  if (cursorIndex < inputScroll) {
    inputScroll = cursorIndex;
  }
  if (cursorIndex > inputScroll + fieldWidth) {
    inputScroll = cursorIndex - fieldWidth;
  }

  const visible = chars.slice(inputScroll, inputScroll + fieldWidth).join("");
  inputBox.setContent(`${prompt}${visible}`);

  screen.render();

  const relativeCursor = Math.max(0, Math.min(fieldWidth, cursorIndex - inputScroll));
  const row = inputBox.atop + 1;
  const col = inputBox.aleft + 2 + promptChars + relativeCursor;
  setCursorVisible(true);
  screen.program.cup(row, col);
}

function setInputBuffer(value) {
  inputBuffer = value;
  cursorIndex = Array.from(value).length;
  inputScroll = 0;
}

function insertChar(ch) {
  const chars = Array.from(inputBuffer);
  chars.splice(cursorIndex, 0, ch);
  inputBuffer = chars.join("");
  cursorIndex += 1;
}

function removeCharBeforeCursor() {
  if (cursorIndex <= 0) {
    return;
  }
  const chars = Array.from(inputBuffer);
  chars.splice(cursorIndex - 1, 1);
  inputBuffer = chars.join("");
  cursorIndex -= 1;
}

function removeCharAtCursor() {
  if (cursorIndex >= inputBuffer.length) {
    return;
  }
  const chars = Array.from(inputBuffer);
  chars.splice(cursorIndex, 1);
  inputBuffer = chars.join("");
}

function formatError(err) {
  if (typeof err === "string") {
    return err;
  }
  return String(err?.description || err?.message || "unknown error");
}

function logStatus(level, text) {
  const entry = STATUS_STYLES[level] || STATUS_STYLES.info;
  logsBox.log(
    `{${entry.color}-fg}{bold}${entry.symbol}{/bold}{/${entry.color}-fg}  {white-fg}${text}{/white-fg}`,
  );
  logsBox.setScrollPerc(100);
  renderInput();
}

const manager = new BotManager({ config, log: logStatus });

function refreshBots() {
  const names = manager.activeNames();
  const count = names.length;
  botsBox.setLabel(count > 0 ? ` Active Bots {yellow-fg}(${count}){/yellow-fg} ` : " Active Bots ");
  botsBox.setContent(count > 0 ? names.join("\n") : "(none)");
  renderHeader();
  renderInput();
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  try {
    // Every bot has to leave, otherwise the lobby keeps unkickable ghosts.
    await manager.shutdown();
  } catch (err) {
    console.error(`Failed to remove bots during shutdown: ${formatError(err)}`);
  }

  setCursorVisible(true);
  screen.destroy();
  process.exit(exitCode);
}

const commands = createCommands({
  manager,
  config,
  log: logStatus,
  refresh: refreshBots,
  onExit: () => shutdown(0),
});

function submitCurrentInput() {
  const value = inputBuffer;
  setInputBuffer("");

  if (value.trim()) {
    commandHistory.unshift(value);
    if (commandHistory.length > 100) {
      commandHistory.pop();
    }
  }
  historyIndex = -1;
  historySavedInput = "";

  renderInput();

  commandQueue = commandQueue
    .then(() => commands.handle(value))
    .catch((err) => {
      logStatus("err", `Fatal error: ${formatError(err)}`);
      return shutdown(1);
    });
}

process.on("uncaughtException", (err) => {
  logStatus("err", `Uncaught error: ${formatError(err)}`);
  shutdown(1).catch(() => {
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason) => {
  logStatus("err", `Unhandled rejection: ${formatError(reason)}`);
  shutdown(1).catch(() => {
    process.exit(1);
  });
});

function handleExitSignal() {
  shutdown(0).catch(() => {
    process.exit(0);
  });
}

for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"]) {
  process.on(signal, handleExitSignal);
}

screen.key(["C-c"], handleExitSignal);

screen.on("keypress", (ch, key) => {
  if (key?.ctrl) {
    return;
  }

  switch (key?.name) {
    case "enter":
      submitCurrentInput();
      return;
    case "up":
      if (commandHistory.length === 0) return;
      if (historyIndex === -1) historySavedInput = inputBuffer;
      historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
      setInputBuffer(commandHistory[historyIndex]);
      break;
    case "down":
      if (historyIndex === -1) return;
      historyIndex -= 1;
      setInputBuffer(historyIndex === -1 ? historySavedInput : commandHistory[historyIndex]);
      break;
    case "left":
      cursorIndex = Math.max(0, cursorIndex - 1);
      break;
    case "right":
      cursorIndex = Math.min(Array.from(inputBuffer).length, cursorIndex + 1);
      break;
    case "home":
      cursorIndex = 0;
      break;
    case "end":
      cursorIndex = Array.from(inputBuffer).length;
      break;
    case "backspace":
      removeCharBeforeCursor();
      break;
    case "delete":
      removeCharAtCursor();
      break;
    default:
      if (typeof ch !== "string" || ch < " " || ch === "\u007f") return;
      insertChar(ch);
  }

  renderInput();
});

screen.on("resize", () => {
  renderInput();
});

refreshBots();
setInputBuffer("");
renderInput();
logStatus("info", "Enter PIN to start");
logStatus("info", "Run help to list commands");
