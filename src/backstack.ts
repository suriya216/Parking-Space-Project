// Centralised browser-Back handling for a single-route app.
//
// Every open view (spot detail, confirmation, modal sheet, secondary tab)
// registers a handler here. One listener routes each back press to the
// topmost handler, LIFO.
//
// Three constraints, each learned from a real failure:
//
//  1. It must be centralised. A `popstate` event says nothing about *which*
//     history entry was removed, so one listener per view means every view
//     fires on every pop and they interfere (closing a spot opened from the
//     Saved tab would also reset the tab).
//
//  2. Never call `history.back()` to tidy up. It is ASYNCHRONOUS: React
//     StrictMode runs effects mount → cleanup → mount in development, and
//     the remount reads `history.state` before the queued back() has
//     applied. It therefore sees a stale "sentinel is current" and skips
//     arming — leaving a live view with no sentinel, so one Back press
//     exits the app to a blank page.
//
//  3. Sentinel bookkeeping must live in a module flag, not be re-derived
//     from `history.state`, for the same timing reason.
//
// Consequence of (2): closing a view from inside the app leaves one spent
// sentinel behind. That costs at most one no-op Back press at the top
// level, which is a far better failure mode than ejecting the user
// mid-session.

interface GuardEntry {
  run: () => void;
  consumed: boolean;
}

/**
 * The slice of History this module uses. Narrowed to what it actually
 * touches so the test fake only has to implement those members — see
 * `__setHistoryForTests`.
 */
interface HistoryLike {
  pushState: (state: unknown, title: string, url?: string) => void;
}

let stack: GuardEntry[] = [];
// True when our sentinel entry is on the history stack. Authoritative —
// deliberately not read back from history.state.
let armed = false;
// Pops we triggered ourselves (none currently, kept for the test seam).
let selfPops = 0;
let hist: HistoryLike | null =
  typeof window !== "undefined" ? window.history : null;

const arm = (): void => {
  if (!armed) {
    armed = true;
    hist?.pushState({ psGuard: true }, "");
  }
};

/** Route a back press to the topmost guard. Exported for tests. */
export const handlePop = (): void => {
  // Whatever entry we were sitting on has now been consumed.
  const wasArmed = armed;
  armed = false;

  if (selfPops > 0) {
    selfPops -= 1;
    return;
  }

  const top = stack[stack.length - 1];
  // No guards: this was a spent sentinel left by an in-app close. Let it go.
  if (!top) return;
  // Not our entry — don't hijack a genuine navigation.
  if (!wasArmed) return;

  top.consumed = true;
  // Re-arm for the views still underneath (a modal over a detail screen).
  if (stack.length > 1) arm();
  top.run();
};

/**
 * Register a back handler.
 * @returns release — call on unmount.
 */
export const pushGuard = (run: () => void): (() => void) => {
  const entry: GuardEntry = { run, consumed: false };
  stack.push(entry);
  arm();

  return () => {
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    // No history.back() here — see note (2) above. The sentinel stays
    // armed and is reused by the next guard, or harmlessly spent by a
    // later top-level back press.
  };
};

export const depth = (): number => stack.length;
export const isArmed = (): boolean => armed;

/** Test seam: swap in a fake history and reset module state. */
export const __setHistoryForTests = (fake: HistoryLike): void => {
  hist = fake;
  stack = [];
  armed = false;
  selfPops = 0;
};

if (typeof window !== "undefined") {
  window.addEventListener("popstate", handlePop);
}
