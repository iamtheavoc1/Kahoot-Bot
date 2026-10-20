// Known answers.
//
// A Kahoot game tells the client which option was correct once the question
// is over. `QuestionEnd` carries `correctChoices`. That is worth keeping: run
// a quiz once, and the next run of the same quiz can answer every question
// from the recording, with no text and no resolver.
//
// This is the floor that works whatever the host's settings are.
//
// The recording is keyed by PIN and fingerprinted, so a different quiz
// played at the same PIN does not inherit the wrong answers.

import fs from "node:fs";
import path from "node:path";

const SAVE_DELAY_MS = 1000;

export class KnownAnswers {
  constructor({ file, enabled = true } = {}) {
    this.file = file ?? process.env.KNOWN_ANSWERS_FILE ?? "known-answers.json";
    this.enabled = enabled;
    this.data = {};
    this.dirty = false;
    this.timer = null;
    this._load();
  }

  _load() {
    if (!this.enabled) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        this.data = parsed;
      }
    } catch {
      this.data = {};
    }
  }

  _scheduleSave() {
    if (!this.enabled || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  /** Write the file now. Called on shutdown and by the debounce timer. */
  save() {
    if (!this.enabled || !this.dirty) {
      return;
    }
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
      // A read-only directory is not worth crashing over.
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.save();
  }

  /**
   * The recorded answer for a question, or null.
   * A fingerprint mismatch means it is a different quiz, so nothing applies.
   */
  get(pin, fingerprint, index) {
    if (!this.enabled || !pin || index === null || index === undefined) {
      return null;
    }
    const entry = this.data[String(pin)];
    if (!entry || !entry.answers) {
      return null;
    }
    if (fingerprint && entry.fingerprint && entry.fingerprint !== fingerprint) {
      return null;
    }
    const answer = entry.answers[String(index)];
    return Array.isArray(answer) && answer.length > 0 ? answer : null;
  }

  /** Remember the correct options for a question. */
  record(pin, fingerprint, index, correctChoices) {
    if (!this.enabled || !pin || index === null || index === undefined) {
      return;
    }
    if (!Array.isArray(correctChoices) || correctChoices.length === 0) {
      return;
    }

    const key = String(pin);
    const existing = this.data[key];

    if (!existing) {
      this.data[key] = { fingerprint: fingerprint ?? "", answers: { [String(index)]: correctChoices } };
      this.dirty = true;
      this._scheduleSave();
      return;
    }

    // A different quiz at the same PIN: start the recording again.
    if (fingerprint && existing.fingerprint && existing.fingerprint !== fingerprint) {
      existing.fingerprint = fingerprint;
      existing.answers = {};
    } else if (fingerprint && !existing.fingerprint) {
      existing.fingerprint = fingerprint;
    }

    const current = existing.answers[String(index)];
    if (current && current.length === correctChoices.length && current.every((v, i) => v === correctChoices[i])) {
      return;
    }

    existing.answers[String(index)] = correctChoices;
    this.dirty = true;
    this._scheduleSave();
  }

  /** How many questions are recorded for a quiz. */
  count(pin) {
    const entry = this.data[String(pin)];
    return entry?.answers ? Object.keys(entry.answers).length : 0;
  }
}
