/**
 * Unit tests for src/qr.ts — the text a booking's QR code encodes.
 *
 * Runs in the `unit` project: no browser, no server. This used to be
 * asserted through the UI by clicking a "What's in this code?" toggle that
 * dumped the payload on the confirmation screen; the toggle was only ever
 * there for inspection, so the contract now lives here instead.
 */

import { expect, test } from "@playwright/test";

import { bookingQrPayload, passUrl, type QrBooking } from "../../../src/qr";

const PASS_TOKEN = "3f9a1c07b24e5d8619af730c5b2e4d16";

const booking = (): QrBooking =>
  ({
    ref: "PS-4821",
    status: "active",
    date: "21 Sep 2026",
    time: "14:30",
    hours: 2,
    total: 198,
    pass_token: PASS_TOKEN,
    spot: {
      name: "Selva Street Covered Lot",
      address: "12 Selva St, T. Nagar, Chennai",
      type: "Covered",
      vehicle: "Sedan",
      price: 90,
      lat: 13.041234,
      lng: 80.233456,
    },
    user: { name: "Asha Kumar" },
  }) as unknown as QrBooking;

test("encodes the details a driver and a spot owner need", () => {
  const payload = bookingQrPayload(booking(), "https://parkspace.example");
  const lines = payload.split("\n");

  expect(lines).toEqual([
    "ParkSpace booking PS-4821",
    "Status: active",
    "Spot: Selva Street Covered Lot",
    "Address: 12 Selva St, T. Nagar, Chennai",
    "Type: Covered · Fits: Sedan",
    "Date: 21 Sep 2026",
    "Time: 14:30 (2h)",
    "Paid: INR 198 (INR 90/hr + 10% fee)",
    "Driver: Asha Kumar",
    "Location: 13.04123,80.23346",
    "Map: https://www.openstreetmap.org/?mlat=13.041234&mlon=80.233456#map=18/13.041234/80.233456",
    `Open: https://parkspace.example/?pass=${PASS_TOKEN}`,
  ]);
});

test("links on the pass token, never the booking reference", () => {
  /* The reason the token exists: a ref is five digits, so a ref-keyed
     pass URL would be enumerable. */
  const payload = bookingQrPayload(booking(), "https://parkspace.example");
  const link = payload.split("\n").find((l) => l.startsWith("Open: ")) ?? "";

  expect(link).toContain(`pass=${PASS_TOKEN}`);
  expect(link).not.toContain("PS-4821");
  expect(link).not.toContain("booking=");
});

test("omits the link when no origin is known", () => {
  const payload = bookingQrPayload(booking());

  expect(payload).not.toContain("Open:");
  expect(payload).toContain("ParkSpace booking PS-4821");
});

test("omits the link for a booking with no pass token yet", () => {
  /* Rather than emitting "?pass=null" and printing a dead code. */
  const payload = bookingQrPayload(
    { ...booking(), pass_token: null },
    "https://parkspace.example",
  );

  expect(payload).not.toContain("Open:");
  expect(payload).toContain("Spot: Selva Street Covered Lot");
});

test("passUrl builds the in-app pass link", () => {
  expect(passUrl(PASS_TOKEN, "https://parkspace.example")).toBe(
    `https://parkspace.example/?pass=${PASS_TOKEN}`,
  );
  expect(passUrl(PASS_TOKEN)).toBe(`/?pass=${PASS_TOKEN}`);
});
