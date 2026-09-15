// Builds the text encoded into a booking's QR code.
//
// Plain readable lines rather than JSON or a custom URI scheme: any
// off-the-shelf scanner app then displays the details directly, so an
// attendant can read the booking without this app installed and without
// network access.

import type { Booking, Spot, User } from "@shared/models";

/**
 * A booking as the QR needs it: the row plus the joined spot and driver.
 * `/api/bookings` returns exactly this shape.
 */
export interface QrBooking extends Booking {
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
    ...(origin ? [`Verify: ${origin}/?booking=${b.ref}`] : []),
  ].join("\n");
