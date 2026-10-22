/**
 * The booking pass API — what a scanned QR code resolves to.
 *
 * The feature under test is that ONE url serves two audiences and the
 * server, not the client, decides which you are:
 *
 *   - the owner of the spot: full details, and may confirm the car
 *     arrived and parked;
 *   - anyone else, the driver on a second phone included: the parking
 *     details alone, with no driver name, no payment label and no way to
 *     confirm an arrival.
 *
 * It also pins down the reason the pass is keyed on a random token rather
 * than the booking reference: refs are five digits, so a ref-keyed public
 * endpoint would be enumerable.
 */

import { USERS, expect, newAccount, test } from "@fixtures/index";
import type { ApiClient } from "@fixtures/api.fixture";
import type { Spot } from "@shared/models";

/**
 * A spot the SEEDED owner actually owns. Arrival confirmation is scoped to
 * the owner of that specific spot, so booking an unowned listing would
 * make the owner look unauthorised for the wrong reason.
 */
const OWNED_SPOT = "Lakshmi Residency";

const ownedSpot = (spots: Spot[]): Spot => {
  const spot = spots.find((s) => s.name === OWNED_SPOT);
  expect(spot, `seeded spot "${OWNED_SPOT}" must exist`).toBeDefined();
  return spot!;
};

/** Book the owner's spot as the seeded driver; returns the pass token. */
const arrangeBooking = async (api: ApiClient) => {
  const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
  const spot = ownedSpot((await api.spots()).data.spots);
  const created = await api.createBooking(driver.token, { spotId: spot.id, hours: 2 });
  const booking = created.data.booking;

  expect(booking.pass_token, "a new booking must carry a pass token").toBeTruthy();
  return { driver, spot, booking, passToken: booking.pass_token! };
};

test.describe("GET /api/pass/:token", () => {
  test("a stranger with the code sees the parking details and nothing personal", async ({
    api,
  }) => {
    const { passToken, booking, spot } = await arrangeBooking(api);

    /* No Authorization header at all — this is a passer-by scanning a
       code taped to a wall. */
    const res = await api.pass(passToken);
    expect(res.status).toBe(200);

    const pass = res.data.pass;
    expect(pass.viewer).toBe("public");
    expect(pass.ref).toBe(booking.ref);
    expect(pass.spot.name).toBe(spot.name);
    expect(pass.spot.address).toBe(spot.address);

    /* The whole point of the public view: nothing about the person. */
    expect(pass.driver).toBeUndefined();
    expect(pass.paidVia).toBeUndefined();
    expect(pass.canConfirmArrival).toBe(false);

    /* And nothing leaks through a field nobody looked at. */
    const body = JSON.stringify(pass);
    expect(body).not.toContain(USERS.driver.email);
    expect(body).not.toContain(passToken);

    await api.cancelBooking((await api.loginOrThrow(USERS.driver.email, USERS.driver.password)).token, booking.id);
  });

  test("the spot's owner sees the driver and may confirm the arrival", async ({ api }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);

    const res = await api.pass(passToken, owner.token);
    expect(res.status).toBe(200);

    const pass = res.data.pass;
    expect(pass.viewer).toBe("owner");
    expect(pass.driver?.name).toBeTruthy();
    expect(pass.canConfirmArrival).toBe(true);
    expect(pass.arrivedAt).toBeNull();

    await api.cancelBooking(driver.token, booking.id);
  });

  test("the driver sees their own booking but cannot confirm their own arrival", async ({
    api,
  }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);

    const res = await api.pass(passToken, driver.token);
    expect(res.status).toBe(200);

    const pass = res.data.pass;
    expect(pass.viewer).toBe("driver");
    expect(pass.driver?.name).toBeTruthy();
    /* Self-certifying an arrival would make the owner's check-in
       meaningless, so the driver is explicitly not offered it. */
    expect(pass.canConfirmArrival).toBe(false);

    await api.cancelBooking(driver.token, booking.id);
  });

  test("an unrelated signed-in user is treated as the public", async ({ api }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);
    const stranger = await api.register(newAccount("owner"));
    expect(stranger.ok).toBe(true);

    const res = await api.pass(passToken, stranger.data.token);
    expect(res.status).toBe(200);

    /* An owner account that owns a DIFFERENT spot is not this spot's
       owner — the check is per-spot, not per-role. */
    expect(res.data.pass.viewer).toBe("public");
    expect(res.data.pass.driver).toBeUndefined();
    expect(res.data.pass.canConfirmArrival).toBe(false);

    await api.cancelBooking(driver.token, booking.id);
  });

  test("an unknown or malformed token is a flat 404", async ({ api }) => {
    /* Same answer for a well-formed-but-unknown token as for a malformed
       one, so the shape of a real token can't be probed by comparing
       responses. `%2E%2E%2F` is the traversal attempt written so it
       survives to the handler — an unescaped "../" is collapsed by the
       client before the request is even sent, which tests nothing. */
    const bad = [
      "a".repeat(32), // right shape, no such booking
      "z".repeat(32), // right length, not hex
      "PS-78421", // a booking reference
      "abc",
      "%2E%2E%2Fbookings",
    ];

    for (const token of bad) {
      const res = await api.pass(token);
      expect(res.status, `token "${token}" should not resolve`).toBe(404);
    }
  });

  test("the booking reference is not a pass token", async ({ api }) => {
    /* The reason the token exists. A five-digit ref would be walkable in
       a few thousand requests, so it must not open a pass. */
    const { booking, driver } = await arrangeBooking(api);

    const byRef = await api.pass(booking.ref);
    expect(byRef.status).toBe(404);

    await api.cancelBooking(driver.token, booking.id);
  });
});

test.describe("POST /api/pass/:token/arrival", () => {
  test("the owner confirms, and it sticks", async ({ api }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);

    const confirmed = await api.confirmArrival(passToken, owner.token);
    expect(confirmed.status).toBe(200);
    expect(confirmed.data.pass.arrivedAt).toBeTruthy();

    /* Visible to the driver too — it is their proof of check-in. */
    const seen = await api.pass(passToken, driver.token);
    expect(seen.data.pass.arrivedAt).toBeTruthy();

    /* And on the booking row itself. */
    const rows = await api.bookings(driver.token);
    expect(rows.data.bookings.find((b) => b.id === booking.id)?.arrived_at).toBeTruthy();

    await api.cancelBooking(driver.token, booking.id);
  });

  test("a second confirmation keeps the first timestamp", async ({ api }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);

    const first = await api.confirmArrival(passToken, owner.token);
    const second = await api.confirmArrival(passToken, owner.token);

    expect(second.status).toBe(200);
    /* Re-scanning must not quietly move the arrival later. */
    expect(second.data.pass.arrivedAt).toBe(first.data.pass.arrivedAt);

    await api.cancelBooking(driver.token, booking.id);
  });

  test("the driver cannot confirm their own arrival", async ({ api }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);

    const res = await api.confirmArrival(passToken, driver.token);
    expect(res.status).toBe(403);
    expect((await api.pass(passToken, driver.token)).data.pass.arrivedAt).toBeNull();

    await api.cancelBooking(driver.token, booking.id);
  });

  test("holding the token alone is not enough to confirm", async ({ api }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);

    /* Reading a pass needs no session; writing to one does. */
    const res = await api.confirmArrival(passToken);
    expect(res.status).toBe(401);

    await api.cancelBooking(driver.token, booking.id);
  });

  test("a cancelled booking cannot be checked in", async ({ api }) => {
    const { passToken, booking, driver } = await arrangeBooking(api);
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);

    await api.cancelBooking(driver.token, booking.id);

    const res = await api.confirmArrival(passToken, owner.token);
    expect(res.status).toBe(409);

    /* The pass still resolves — a cancelled booking is exactly what an
       owner needs to see when a car turns up anyway. */
    const pass = await api.pass(passToken, owner.token);
    expect(pass.status).toBe(200);
    expect(pass.data.pass.status).toBe("cancelled");
    expect(pass.data.pass.canConfirmArrival).toBe(false);
  });
});
