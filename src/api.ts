// Client for the ParkSpace API. Requests go to /api/* on this origin and
// Vite proxies them to the Express server (see vite.config.js).

import type {
  AuthProviders,
  Booking,
  OwnerEarnings,
  PasswordResetResult,
  PaymentMethod,
  Place,
  Role,
  Session,
  Spot,
  SpotPhoto,
  User,
  Vehicle,
  AdminStats,
} from "@shared/models";

const SESSION_KEY = "parkspace.session";

// Errors are translated once, here, so no screen ever shows raw browser
// text. `fetch` rejects with "Failed to fetch" for offline, DNS failure,
// a dead server and a blocked request alike — meaningless to a user.
export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    { status = 0, retryable = false }: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string;
}

const request = async <T>(path: string, opts: RequestOptions = {}): Promise<T> => {
  const { method = "GET", body, token } = opts;
  let res: Response;

  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      navigator.onLine
        ? "Can't reach ParkSpace right now. The server may be restarting."
        : "You appear to be offline. Check your connection and try again.",
      { retryable: true },
    );
  }

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };

  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 429;

    // A 401 means the session is gone, so there is nothing the current
    // screen can do about it. Hand control to the app, which signs out and
    // returns to the login screen rather than leaving a broken page with
    // an error on it.
    if (res.status === 401) {
      const message = "Your session has expired. Please sign in again.";
      unauthorizedHandler?.(message);
      throw new ApiError(message, { status: 401 });
    }

    // A server-side message is written for humans, so prefer it; otherwise
    // fall back to something readable per status rather than a bare code.
    if (data.error) {
      throw new ApiError(data.error, { status: res.status, retryable });
    }

    const byStatus: Record<number, string> = {
      403: "You don't have permission to do that.",
      404: "That isn't available any more.",
      429: "Too many attempts. Please wait a moment and try again.",
    };
    throw new ApiError(
      byStatus[res.status] ??
        (res.status >= 500
          ? "Something went wrong on our side. Please try again."
          : "That didn't work. Please try again."),
      { status: res.status, retryable },
    );
  }

  return data;
};

// Registered by App so an expired session can drop straight back to the
// sign-in screen from anywhere in the app.
type UnauthorizedHandler = (message: string) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;
export const onUnauthorized = (fn: UnauthorizedHandler): void => {
  unauthorizedHandler = fn;
};

export const login = (email: string, password: string): Promise<Session> =>
  request("/login", { method: "POST", body: { email, password } });

export const register = (payload: {
  name: string;
  email: string;
  password: string;
  role: Role;
}): Promise<Session> => request("/register", { method: "POST", body: payload });

// Omitting lat/lng returns every spot with distance: null. Passing them
// returns real haversine distances, sorted nearest-first.
export const getSpots = ({
  lat,
  lng,
  radius,
}: { lat?: number; lng?: number; radius?: number } = {}): Promise<{ spots: Spot[] }> => {
  const q = new URLSearchParams();
  if (lat != null && lng != null) {
    q.set("lat", String(lat));
    q.set("lng", String(lng));
  }
  if (radius != null) q.set("radius", String(radius));
  const qs = q.toString();
  return request(`/spots${qs ? `?${qs}` : ""}`);
};

export const createSpot = (
  token: string,
  payload: Record<string, unknown>,
): Promise<{ spot: Spot }> => request("/spots", { method: "POST", token, body: payload });

// ─── SPOT PHOTOS ────────────────────────────────────────
export const getSpotPhotos = (
  token: string,
): Promise<{ photos: SpotPhoto[]; stock: string[] }> => request("/spot-photos", { token });

export const uploadSpotPhoto = (
  token: string,
  dataUrl: string,
  label: string,
): Promise<{ photo: SpotPhoto; type: string }> =>
  request("/spot-photos", { method: "POST", token, body: { dataUrl, label } });

export const deleteSpotPhoto = (
  token: string,
  id: number,
): Promise<{ ok: boolean; fileRemoved: boolean }> =>
  request(`/spot-photos/${id}`, { method: "DELETE", token });

export const setSpotVerified = (
  token: string,
  id: number,
  verified: boolean,
): Promise<{ spot: Spot }> =>
  request(`/spots/${id}`, { method: "PATCH", token, body: { verified } });

export const deleteSpot = (token: string, id: number): Promise<{ ok: boolean }> =>
  request(`/spots/${id}`, { method: "DELETE", token });

// ─── AUTH EXTRAS ────────────────────────────────────────
export const requestPasswordReset = (email: string): Promise<PasswordResetResult> =>
  request("/password-reset", { method: "POST", body: { email } });

// ─── OAUTH ──────────────────────────────────────────────
// Which providers have credentials configured server-side. `demoSso` used
// to live here and signed the seeded driver in for any provider; both
// Google and Apple now run the real flow, so it is gone.
export const getAuthProviders = async (): Promise<AuthProviders> => {
  try {
    const d = await request<Partial<AuthProviders>>("/auth/providers");
    return { providers: d.providers ?? [], demoMode: Boolean(d.demoMode) };
  } catch {
    return { providers: [], demoMode: false };
  }
};

// A full-page redirect, not fetch: the provider's consent screen has to be
// rendered by the browser, and it refuses to be framed or XHR'd.
export const startOAuth = (providerId: string): void => {
  window.location.href = `/api/auth/${providerId}/start`;
};

// Trades the one-time code the callback put in the URL for a session.
export const exchangeOAuthCode = (code: string): Promise<Session> =>
  request("/auth/exchange", { method: "POST", body: { code } });

// ─── PROFILE ────────────────────────────────────────────
export const updateProfile = (
  token: string,
  payload: Partial<Pick<User, "name" | "email" | "phone">>,
): Promise<Session> => request("/me", { method: "PATCH", token, body: payload });

export const changePassword = (
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean }> =>
  request("/me/password", { method: "POST", token, body: { currentPassword, newPassword } });

// ─── BOOKINGS ───────────────────────────────────────────
export const getBookings = (token: string): Promise<{ bookings: Booking[] }> =>
  request("/bookings", { token });

// The date and time window are derived server-side from `startAt`
// (defaults to now), so they always agree with the hours booked.
export const createBooking = (
  token: string,
  { spotId, hours, startAt }: { spotId: number; hours: number; startAt?: string },
): Promise<{ booking: Booking }> =>
  request("/bookings", { method: "POST", token, body: { spotId, hours, startAt } });

export const cancelBooking = (
  token: string,
  id: number,
): Promise<{ booking: Booking }> =>
  request(`/bookings/${id}`, { method: "PATCH", token, body: { status: "cancelled" } });

export const extendBooking = (
  token: string,
  id: number,
  extendHours: number,
): Promise<{ booking: Booking }> =>
  request(`/bookings/${id}`, { method: "PATCH", token, body: { extendHours } });

// ─── FAVOURITES ─────────────────────────────────────────
// All three routes answer with the caller's full list of spot ids, not
// spot objects — the client intersects them with the spots it has.
export const getFavourites = (token: string): Promise<{ favourites: number[] }> =>
  request("/favourites", { token });

export const addFavourite = (
  token: string,
  spotId: number,
): Promise<{ favourites: number[] }> =>
  request(`/favourites/${spotId}`, { method: "PUT", token });

export const removeFavourite = (
  token: string,
  spotId: number,
): Promise<{ favourites: number[] }> =>
  request(`/favourites/${spotId}`, { method: "DELETE", token });

// ─── VEHICLES ───────────────────────────────────────────
export const getVehicles = (token: string): Promise<{ vehicles: Vehicle[] }> =>
  request("/vehicles", { token });

export const addVehicle = (
  token: string,
  payload: { label: string; plate: string; type: string },
): Promise<{ vehicle: Vehicle }> =>
  request("/vehicles", { method: "POST", token, body: payload });

export const deleteVehicle = (token: string, id: number): Promise<{ ok: boolean }> =>
  request(`/vehicles/${id}`, { method: "DELETE", token });

// ─── PAYMENT METHODS ────────────────────────────────────
export const getPaymentMethods = (
  token: string,
): Promise<{ methods: PaymentMethod[] }> => request("/payment-methods", { token });

export const addPaymentMethod = (
  token: string,
  payload: { number: string; exp: string },
): Promise<{ method: PaymentMethod }> =>
  request("/payment-methods", { method: "POST", token, body: payload });

export const deletePaymentMethod = (
  token: string,
  id: number,
): Promise<{ ok: boolean }> =>
  request(`/payment-methods/${id}`, { method: "DELETE", token });

// ─── OWNER / ADMIN ──────────────────────────────────────
export const getOwnerEarnings = (token: string): Promise<OwnerEarnings> =>
  request("/owner/earnings", { token });

// ─── PLACE LOOKUP ───────────────────────────────────────
// Preferred path is the server proxy: it controls the User-Agent the
// geocoder asks for and caches repeated queries.
//
// It falls back to calling Nominatim straight from the browser, because
// behind a TLS-inspecting corporate proxy Node cannot verify the
// certificate chain (UNABLE_TO_GET_ISSUER_CERT_LOCALLY) while the browser
// can — Windows trusts the proxy's root CA and Node does not. Setting
// NODE_EXTRA_CA_CERTS for the server makes the proxy path work again.
//
// Either way the query reaches OpenStreetMap, which is already serving
// the map tiles; the fallback changes who sends it, not where it goes.
const NOMINATIM_DIRECT = "https://nominatim.openstreetmap.org/search";

interface NominatimRow {
  place_id: number | string;
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
}

const normalisePlaces = (rows: NominatimRow[]): Place[] =>
  rows.map((r) => ({
    id: String(r.place_id),
    name: r.name || String(r.display_name).split(",")[0] || r.display_name,
    label: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));

export const searchPlaces = async (q: string): Promise<Place[]> => {
  try {
    const d = await request<{ places?: Place[]; error?: string }>(
      `/places?q=${encodeURIComponent(q)}`,
    );
    if (d.places?.length) return d.places;
    // An empty list from a healthy proxy is a real "no matches"; only fall
    // through when the proxy itself reported a failure.
    if (!d.error) return d.places ?? [];
  } catch {
    // proxy unreachable — try direct below
  }

  try {
    const url = `${NOMINATIM_DIRECT}?${new URLSearchParams({
      q,
      format: "jsonv2",
      limit: "6",
      addressdetails: "1",
      countrycodes: "in",
    })}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    return normalisePlaces((await res.json()) as NominatimRow[]);
  } catch {
    return [];
  }
};

export const listUsers = (token: string): Promise<{ users: User[] }> =>
  request("/users", { token });

export const getStats = (token: string): Promise<AdminStats> =>
  request("/stats", { token });

export const setUserRole = (
  token: string,
  id: number,
  role: Role,
): Promise<{ user: User }> =>
  request(`/users/${id}`, { method: "PATCH", token, body: { role } });

export const deleteUser = (token: string, id: number): Promise<{ ok: boolean }> =>
  request(`/users/${id}`, { method: "DELETE", token });

// ─── SESSION PERSISTENCE ────────────────────────────────
// Keeps you signed in across reloads. The token is unsigned in dev, so
// this is a convenience only — see the note in server/index.js.
export const saveSession = (session: Session): void =>
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));

export const loadSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

export const clearSession = (): void => localStorage.removeItem(SESSION_KEY);
