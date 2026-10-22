/**
 * Domain models, mirroring the SQLite schema in server/db.js and the JSON
 * the API actually returns. Shared by the React client and the Playwright
 * API tests so a response-shape change breaks both at compile time.
 *
 * On booleans: SQLite has no boolean type, so `spots.verified` is stored
 * as INTEGER 0/1 — but `rowToSpot` in server/db.js coerces it with
 * Boolean() before serialising. The wire format is therefore a real
 * boolean, and that is what these types describe. Describing the storage
//  * rather than the response is how a test ends up asserting `toBe(0)`
 * against a `false`.
 */

export type Role = "driver" | "owner" | "admin";
export type BookingStatus = "active" | "completed" | "cancelled";
export type PaymentStatus = "confirmed" | "pending" | "failed";
/** Methods a spot can accept. "online" covers card/UPI/netbanking via the gateway. */
export type PaymentMode = "online" | "cash";
export type Units = "km" | "mi";

/** Columns the server is willing to expose (db.js PUBLIC_COLS). */
export interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  /** This account's role, fixed when it was created. */
  role: Role;
  /**
   * Always `[role]`. An account holds exactly one role — somebody who both
   * parks and rents out a space keeps two accounts on the same email, each
   * with its own password. Kept as a list so callers read one shape.
   */
  roles: Role[];
  provider: string;
  avatar: string;
  /** Owner's UPI id for payouts. Optional; blank when not set. */
  upi_id: string;
  created_at: string;
}

export interface Session {
  token: string;
  user: User;
}

/**
 * An address can hold one account per role, and sign-in does not ask which
 * one up front — the password normally identifies it. When the same
 * password opens more than one, the server answers with the choices
 * instead of a session, and the client signs in again naming a role.
 */
export interface RoleChoice {
  chooseRole: Role[];
}

export type LoginResult = Session | RoleChoice;

export interface Spot {
  id: number;
  name: string;
  address: string;
  type: string;
  vehicle: string;
  price: number;
  rating: number;
  reviews: number;
  /** Coerced to a real boolean by rowToSpot() before it leaves the server. */
  verified: boolean;
  lat: number;
  lng: number;
  photo: string;
  owner: string;
  available: string;
  since: number;
  /** haversine metres, only when the query supplied lat/lng. */
  distance: number | null;
  /** JSON array of accepted payment methods: ["card", "upi", "cash"] */
  accepted_payment_methods?: string;
}

export interface Booking {
  id: number;
  user_id: number;
  spot_id: number;
  ref: string;
  date: string;
  time: string;
  hours: number;
  total: number;
  status: BookingStatus;
  payment_status: PaymentStatus;
  created_at: string;
  /** Display label for how it was paid, e.g. "Visa ···· 4242" or "Cash". */
  paid_via: string;
  /**
   * Unguessable handle the QR code encodes. Present on a booking the
   * caller owns (driver, spot owner, admin) because they render the pass;
   * never included in a `/api/pass/:token` response.
   */
  pass_token: string | null;
  /** Set when the spot's owner confirmed the car arrived and parked. */
  arrived_at: string | null;
  arrived_by: number | null;
  /** joined from spots for list rendering. */
  spot?: Spot;
  /** joined from users; the driver who made the booking. */
  user?: Pick<User, "id" | "name" | "email">;
}

/** Who is looking at a pass, as resolved server-side from the session. */
export type PassViewer = "owner" | "driver" | "admin" | "public";

/**
 * A booking as `/api/pass/:token` returns it — the screen the QR code
 * opens. The parking details are always present; the driver's name and
 * the payment label are added only for the spot's owner, the driver
 * themselves, or an admin.
 */
export interface BookingPass {
  ref: string;
  status: BookingStatus;
  date: string;
  time: string;
  hours: number;
  total: number;
  arrivedAt: string | null;
  spot: Pick<
    Spot,
    "name" | "address" | "type" | "vehicle" | "price" | "photo" | "owner" | "lat" | "lng" | "verified"
  >;
  viewer: PassViewer;
  canConfirmArrival: boolean;
  driver?: { name: string };
  paidVia?: string | null;
}

/**
 * How a booking is being paid for. For online payments the client first
 * opens an order (`PaymentOrder`), completes it at the gateway, then submits
 * the signed receipt here. Nothing sensitive is ever persisted.
 */
export type PaymentInput =
  | {
      mode: "online";
      orderId: string;
      paymentId: string;
      signature: string;
      amount: number;
      method?: "upi" | "card" | "netbanking";
    }
  | { mode: "cash" };

/** A payment order the server opens before online checkout. */
export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  live: boolean;
  ownerUpi: string;
}

/** The signed receipt a completed (or demo-completed) payment yields. */
export interface PaymentReceipt {
  paymentId: string;
  signature: string;
}

export interface Vehicle {
  id: number;
  label: string;
  plate: string;
  type: string;
  created_at: string;
}

export interface SpotPhoto {
  id: number;
  path: string;
  label: string;
  created_at: string;
}

export interface Place {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
}

export interface OwnerEarnings {
  total: number;
  bookings: number;
  spots: number;
  [key: string]: unknown;
}

export interface AdminStats {
  spots: number;
  bookings: number;
  users: Array<{ role: Role; n: number }>;
  [key: string]: unknown;
}

export interface AuthProviders {
  providers: Array<{ id: string; label: string }>;
  demoMode: boolean;
}

export interface PasswordResetResult {
  message: string;
  note: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoPosition extends LatLng {
  accuracy: number | null;
  label?: string;
}

/** Shape of every error body the Express handlers produce. */
export interface ApiErrorBody {
  error: string;
}
