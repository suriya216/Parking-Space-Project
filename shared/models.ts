/**
 * Domain models, mirroring the SQLite schema in server/db.js and the JSON
 * the API actually returns. Shared by the React client and the Playwright
 * API tests so a response-shape change breaks both at compile time.
 *
 * On booleans: SQLite has no boolean type, so `spots.verified` is stored
 * as INTEGER 0/1 — but `rowToSpot` in server/db.js coerces it with
 * Boolean() before serialising. The wire format is therefore a real
 * boolean, and that is what these types describe. Describing the storage
 * rather than the response is how a test ends up asserting `toBe(0)`
 * against a `false`.
 */

export type Role = "driver" | "owner" | "admin";
export type BookingStatus = "active" | "completed" | "cancelled";
export type Units = "km" | "mi";

/** Columns the server is willing to expose (db.js PUBLIC_COLS). */
export interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: Role;
  provider: string;
  avatar: string;
  created_at: string;
}

export interface Session {
  token: string;
  user: User;
}

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
  created_at: string;
  /** joined from spots for list rendering. */
  spot?: Spot;
}

export interface Vehicle {
  id: number;
  label: string;
  plate: string;
  type: string;
  created_at: string;
}

export interface PaymentMethod {
  id: number;
  brand: string;
  last4: string;
  exp: string;
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
