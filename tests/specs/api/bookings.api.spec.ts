/**
 * Booking API — ports e2e/booking-time.mjs and the booking half of
 * e2e/api.test.mjs.
 *
 * The point of the time assertions: a booking must carry a real clock
 * window ("10:00 AM – 1:00 PM"), not a vague "Nh from now".
 */

import { USERS, expect, test } from "@fixtures/index";
import type { Spot } from "@shared/models";

/** en-IN clock window, e.g. "10:00 AM – 1:00 PM". */
const CLOCK_WINDOW = /^\d{1,2}:\d{2}\s?(am|pm)\s?[–-]\s?\d{1,2}:\d{2}\s?(am|pm)$/i;

/** en-IN date, e.g. "10 Sept 2026" — 3 or 4 letters for the month. */
const REAL_DATE = /^\d{1,2}\s[A-Za-z]{3,4}\s\d{4}$/;

const startOf = (window: string): string => window.split(/[–-]/)[0]?.trim() ?? "";

const totalFor = (spot: Spot, hours: number): number =>
  Math.round(spot.price * hours * 1.1);

test.describe("POST /api/bookings", () => {
  test("carries a real clock window and the correct total", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);

    /* Look the spot up rather than assuming an id — other specs create
       and delete listings, so a fixed id may not exist. */
    const spots = await api.spots();
    const spot = spots.data.spots[0];
    expect(spot, "a seeded spot must be available to book").toBeDefined();

    const created = await api.createBooking(session.token, {
      spotId: spot!.id,
      hours: 2,
    });
    expect(created.status).toBe(201);

    const booking = created.data.booking;
    expect(booking.time, `time was "${booking.time}"`).toMatch(CLOCK_WINDOW);
    expect(booking.time).not.toMatch(/from now/i);
    expect(booking.time, "meridiem should be uppercase").toMatch(/[AP]M/);
    expect(booking.date, `date was "${booking.date}"`).toMatch(REAL_DATE);
    expect(booking.total).toBe(totalFor(spot!, 2));
    expect(booking.ref).toMatch(/^PS-/);

    await api.cancelBooking(session.token, booking.id);
  });

  test("extending recomputes the total and moves only the end time", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];
    expect(spot).toBeDefined();

    const created = await api.createBooking(session.token, { spotId: spot!.id, hours: 2 });
    const before = created.data.booking;

    const extended = await api.extendBooking(session.token, before.id, 2);
    expect(extended.status).toBe(200);
    const after = extended.data.booking;

    expect(after.total).toBe(totalFor(spot!, 4));
    expect(after.time).toMatch(CLOCK_WINDOW);
    expect(after.time).not.toBe(before.time);
    /* Extending pushes the end out; it must not shift the start. */
    expect(startOf(after.time)).toBe(startOf(before.time));

    await api.cancelBooking(session.token, after.id);
  });

  test("an explicit startAt is honoured in IST", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];
    expect(spot).toBeDefined();

    /* 04:30Z is 10:00 IST, so a 3-hour booking runs 10:00 AM – 1:00 PM. */
    const startAt = new Date("2026-09-10T04:30:00Z").toISOString();
    const created = await api.createBooking(session.token, {
      spotId: spot!.id,
      hours: 3,
      startAt,
    });

    expect(created.status).toBe(201);
    expect(created.data.booking.time).toMatch(/10:00\s?am\s?[–-]\s?1:00\s?pm/i);

    await api.cancelBooking(session.token, created.data.booking.id);
  });

  test("rejects a malformed startAt", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];

    const res = await api.createBooking(session.token, {
      spotId: spot!.id,
      hours: 1,
      startAt: "not-a-date",
    });
    expect(res.status).toBe(400);
  });

  test("rejects zero or negative hours", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];

    for (const hours of [0, -3]) {
      const res = await api.createBooking(session.token, { spotId: spot!.id, hours });
      expect(res.status, `hours=${hours} should be rejected`).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  test("rejects a booking for a spot that does not exist", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const res = await api.createBooking(session.token, { spotId: 999_999, hours: 1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test("requires authentication", async ({ api }) => {
    const res = await api.call("/bookings", {
      method: "POST",
      body: { spotId: 1, hours: 1 },
    });
    expect(res.status).toBe(401);
  });
});

test.describe("booking ownership", () => {
  test("one driver cannot cancel another driver's booking", async ({ api }) => {
    const owner = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];

    const created = await api.createBooking(owner.token, { spotId: spot!.id, hours: 1 });
    const bookingId = created.data.booking.id;

    /* A second, unrelated account must not be able to touch it. */
    const intruder = await api.register({
      name: "Intruder",
      email: `intruder-${Date.now().toString(36)}@parkspace.test`,
      password: "E2ePass@123",
      role: "driver",
    });

    const attempt = await api.cancelBooking(intruder.data.token, bookingId);
    expect(attempt.status).toBeGreaterThanOrEqual(400);

    /* And it is genuinely untouched. */
    const mine = await api.bookings(owner.token);
    expect(mine.data.bookings.find((b) => b.id === bookingId)?.status).toBe("active");

    await api.cancelBooking(owner.token, bookingId);
  });

  test("cancelling twice is refused the second time", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const created = await api.createBooking(session.token, {
      spotId: spots.data.spots[0]!.id,
      hours: 1,
    });

    const first = await api.cancelBooking(session.token, created.data.booking.id);
    expect(first.status).toBe(200);

    const second = await api.cancelBooking(session.token, created.data.booking.id);
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  test("a cancelled booking cannot be extended", async ({ api }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const created = await api.createBooking(session.token, {
      spotId: spots.data.spots[0]!.id,
      hours: 1,
    });
    await api.cancelBooking(session.token, created.data.booking.id);

    const res = await api.extendBooking(session.token, created.data.booking.id, 1);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

test.describe("favourites", () => {
  test("can be added, listed and removed", async ({ api }) => {
    /* A fresh account so the assertions on length are not racing the
       other specs that heart things as the seeded driver. */
    const account = await api.register({
      name: "Favourites Tester",
      email: `fav-${Date.now().toString(36)}@parkspace.test`,
      password: "E2ePass@123",
      role: "driver",
    });
    const token = account.data.token;

    expect((await api.favourites(token)).data.favourites).toHaveLength(0);

    const spots = await api.spots();
    const spot = spots.data.spots[0]!;

    /* The route answers with the updated id list, so no re-fetch needed. */
    const added = await api.addFavourite(token, spot.id);
    expect(added.status).toBe(200);
    expect(added.data.favourites).toContain(spot.id);

    /* Adding twice must be idempotent, not a 500 — the table's primary
       key is (user_id, spot_id). */
    const again = await api.addFavourite(token, spot.id);
    expect(again.status).toBeLessThan(500);
    expect((await api.favourites(token)).data.favourites).toHaveLength(1);

    const removed = await api.removeFavourite(token, spot.id);
    expect(removed.status).toBe(200);
    expect(removed.data.favourites).toHaveLength(0);
  });
});
