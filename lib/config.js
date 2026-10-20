// Runtime configuration.
//
// Environment variables provide the starting values; the `mode`, `resend`,
// `model` and `spam` commands change them while the bot is running.

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Read a game PIN.
 *
 * Returns a string, never a number. Challenge pins start with a zero, and
 * turning "00112233" into 112233 turns a challenge into an ordinary game that
 * does not exist.
 */
export function parsePin(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    return "";
  }
  if (Number(text) === 0) {
    return "";
  }
  return text;
}

export function loadConfig(env = process.env) {
  return {
    // Kept as a string: challenge pins start with a zero, and turning the pin
    // into a number would quietly turn a challenge into a normal game.
    pin: "",
    mode: "perfect",
    resend: toInt(env.RESEND, 0),
    feedbackBurst: toInt(env.FEEDBACK_BURST, 0),
    parallel: Math.max(1, toInt(env.PARALLEL, 35)),
    spamEnabled: true,
    model: env.RESOLVER_MODEL || "gpt-4o-mini",
    resolverBase: env.RESOLVER_BASE || "",
    resolverKey: env.RESOLVER_KEY || "",
  };
}
