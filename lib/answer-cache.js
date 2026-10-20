// Shared answer cache.
//
// Every bot sees the same question at the same moment. Resolving it once per
// bot would mean 150 bots x 20 questions = 3,000 model calls for one game.
// This cache keys on the question index, so a game costs one call per question.
//
// Two things share the cache:
//   - `resolved`  the finished answer, reused by every bot
//   - `pending`   the in-flight promise, so bots arriving mid-call wait for
//                 it instead of starting their own

export class AnswerCache {
  constructor() {
    this.resolved = new Map();
    this.pending = new Map();
  }

  /** Drop everything. Called when the PIN changes. */
  clear() {
    this.resolved.clear();
    this.pending.clear();
  }

  get size() {
    return this.resolved.size;
  }

  /**
   * Resolve the answer for `index` once, no matter how many callers ask.
   * `resolve` is only invoked when there is no cached or in-flight answer.
   */
  async get(index, resolve) {
    if (this.resolved.has(index)) {
      return this.resolved.get(index);
    }
    if (this.pending.has(index)) {
      return this.pending.get(index);
    }

    const promise = Promise.resolve()
      .then(resolve)
      .then((value) => {
        this.resolved.set(index, value);
        this.pending.delete(index);
        return value;
      })
      .catch((error) => {
        this.pending.delete(index);
        throw error;
      });

    this.pending.set(index, promise);
    return promise;
  }
}
