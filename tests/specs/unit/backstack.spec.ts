/**
 * Unit tests for src/backstack.js — ports e2e/backstack.test.mjs.
 *
 * Runs in the `unit` project: no browser, no server, just the module and
 * a fake history.
 *
 * The fake models two things a naive one would hide:
 *   - entries[0] is a pre-app page, so an over-eager back() shows up as
 *     "left the app" instead of passing silently;
 *   - back() is ASYNCHRONOUS, like a real browser. Synchronous fakes are
 *     why an earlier version of this module passed its tests and still
 *     blanked the page in a real browser.
 */

import { expect, test } from "@playwright/test";

import {
  __setHistoryForTests,
  depth,
  handlePop,
  isArmed,
  pushGuard,
} from "../../../src/backstack";

interface Entry {
  url: string;
  state: { psGuard?: boolean } | null;
}

interface FakeHistory {
  entries: Entry[];
  index: number;
  readonly state: Entry["state"];
  /* Signature has to match the real History: the module passes `unknown`
     state, so narrowing it here would not satisfy HistoryLike. */
  pushState: (state: unknown, title?: string) => void;
  back: () => void;
  userBack: () => Promise<void>;
  url: () => string;
  leftApp: () => boolean;
  sentinels: () => number;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const makeHistory = (): FakeHistory => {
  const h: FakeHistory = {
    entries: [
      { url: "about:blank", state: null },
      { url: "/app", state: null },
    ],
    index: 1,
    get state() {
      return h.entries[h.index]?.state ?? null;
    },
    pushState(state) {
      h.entries = h.entries.slice(0, h.index + 1);
      /* The module only ever pushes `{ psGuard: true }`; the cast keeps
         the fake's stored shape usable by `sentinels()` below. */
      h.entries.push({ url: "/app", state: state as Entry["state"] });
      h.index = h.entries.length - 1;
    },
    /* Asynchronous, as in a real browser. */
    back() {
      setTimeout(() => {
        if (h.index > 0) h.index -= 1;
        handlePop();
      }, 0);
    },
    /* A user pressing browser/Android Back. */
    async userBack() {
      h.back();
      await tick();
    },
    url() {
      return h.entries[h.index]?.url ?? "";
    },
    leftApp() {
      return h.url() === "about:blank";
    },
    sentinels() {
      return h.entries.filter((e) => e.state?.psGuard).length;
    },
  };
  return h;
};

const reset = (): FakeHistory => {
  const h = makeHistory();
  __setHistoryForTests(h);
  return h;
};

test("a detail view opened from Home closes on browser Back", async () => {
  const h = reset();
  const log: string[] = [];

  const release = pushGuard(() => log.push("detail"));
  expect(isArmed()).toBe(true);

  await h.userBack();
  expect(log.join()).toBe("detail");

  release();
  expect(h.leftApp(), `url was ${h.url()}`).toBe(false);
  expect(depth()).toBe(0);
});

test("closing a view in-app does not reset the tab underneath it", async () => {
  /* The cross-talk case: a popstate says nothing about WHICH entry was
     removed, so per-view listeners would all fire and closing a spot
     opened from Saved would also reset the tab. */
  const h = reset();
  const log: string[] = [];

  const releaseTab = pushGuard(() => log.push("tab"));
  const releaseDetail = pushGuard(() => log.push("detail"));
  expect(h.sentinels(), "guards share one sentinel").toBe(1);

  releaseDetail(); // the in-app Back button
  expect(log).toHaveLength(0);
  expect(h.leftApp()).toBe(false);

  await h.userBack();
  expect(log.join()).toBe("tab");

  releaseTab();
  expect(h.leftApp(), `url was ${h.url()}`).toBe(false);
});

test("a modal over a detail view unwinds last-in-first-out", async () => {
  const h = reset();
  const log: string[] = [];

  const releaseDetail = pushGuard(() => log.push("detail"));
  const releaseModal = pushGuard(() => log.push("modal"));

  await h.userBack();
  expect(log.join()).toBe("modal");
  releaseModal();

  await h.userBack();
  expect(log.join()).toBe("modal,detail");
  releaseDetail();

  expect(h.leftApp()).toBe(false);
});

test("a StrictMode double-invoke does not blank the page", async () => {
  /* Mount, cleanup, mount — with an async back() in between. This is the
     exact sequence behind the original blank-page bug. */
  const h = reset();
  const log: string[] = [];

  const first = pushGuard(() => log.push("sheet"));
  first();
  const second = pushGuard(() => log.push("sheet"));
  await tick();

  expect(isArmed()).toBe(true);
  expect(h.sentinels(), JSON.stringify(h.entries)).toBe(1);

  await h.userBack();
  expect(log.join()).toBe("sheet");
  expect(h.leftApp(), `url was ${h.url()}`).toBe(false);

  second();
});

test("opening a detail after a tab Back does not eject the app", async () => {
  const h = reset();
  const log: string[] = [];

  const releaseTab = pushGuard(() => log.push("tab"));
  await h.userBack();
  expect(log.join()).toBe("tab");
  releaseTab();

  /* Opening a spot detail now must arm a FRESH sentinel — reusing the
     spent one is what ejected the user. */
  const releaseDetail = pushGuard(() => log.push("detail"));
  await tick();
  expect(isArmed()).toBe(true);

  await h.userBack();
  expect(log.join()).toBe("tab,detail");
  expect(h.leftApp(), `url was ${h.url()}`).toBe(false);

  releaseDetail();
});

test("ten open/close cycles leak nothing and do not drift", async () => {
  const h = reset();

  for (let i = 0; i < 10; i += 1) {
    const release = pushGuard(() => {});
    release();
    await tick();
  }

  expect(h.leftApp(), `url was ${h.url()}`).toBe(false);
  expect(depth(), "no guard leak").toBe(0);
  expect(h.sentinels()).toBeLessThanOrEqual(1);
});

test("a spent sentinel is harmless", async () => {
  const h = reset();
  const log: string[] = [];

  const release = pushGuard(() => log.push("view"));
  release(); // closed from inside the app
  await h.userBack();

  expect(log, "no handler should fire for a spent sentinel").toHaveLength(0);
  expect(h.leftApp()).toBe(false);
});
