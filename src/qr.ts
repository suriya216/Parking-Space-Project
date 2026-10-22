// Builds the text encoded into a booking's QR code.
//
// Plain readable lines rather than JSON or a custom URI scheme: any
// off-the-shelf scanner app then displays the details directly, so an
// attendant can read the booking without this app installed and without
// network access.
//
// The last line is a link into the app, keyed on the booking's pass token
// rather than its reference. Refs are five digits, so a ref-keyed URL
// would let anyone walk the whole booking table; the token is 128 random
// bits and is the only credential the pass screen accepts. The owner
// following that link can confirm the car arrived; everyone else gets the
// parking details alone — see /api/pass/:token in server/index.js.

import type { Booking, Spot, User } from "@shared/models";

/**
 * A booking as the QR needs it: the row plus the joined spot and driver.
 * `/api/bookings` returns exactly this shape. Both joins are optional on
 * `Booking` because other endpoints omit them; here they are required,
 * and the driver is narrowed to the one field the code prints.
 */
export interface QrBooking extends Omit<Booking, "spot" | "user"> {
  spot: Spot;
  user: Pick<User, "name">;
}

export const bookingQrPayload = (b: QrBooking, origin = ""): string =>
  [
    `ParkSpace booking ${b.ref}`,
    `Status: ${b.status}`,
    `Spot: ${b.spot.name}`,
    `Address: ${b.spot.address}`,
    `Type: ${b.spot.type} · Fits: ${b.spot.vehicle}`,
    `Date: ${b.date}`,
    `Time: ${b.time} (${b.hours}h)`,
    `Paid: INR ${b.total} (INR ${b.spot.price}/hr + 10% fee)`,
    `Driver: ${b.user.name}`,
    `Location: ${b.spot.lat.toFixed(5)},${b.spot.lng.toFixed(5)}`,
    `Map: https://www.openstreetmap.org/?mlat=${b.spot.lat}&mlon=${b.spot.lng}#map=18/${b.spot.lat}/${b.spot.lng}`,
    // Both halves have to be known: a booking with no token yet (or a
    // scanner given no origin) gets a readable code without a dead link.
    ...(origin && b.pass_token ? [`Open: ${passUrl(b.pass_token, origin)}`] : []),
  ].join("\n");

/** The in-app pass URL for a token. Also used to build the link directly. */
export const passUrl = (passToken: string, origin = ""): string =>
  `${origin}/?pass=${passToken}`;
