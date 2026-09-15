/**
 * Typed API client over Playwright's request context.
 *
 * Two jobs:
 *   1. It is what the API specs assert against (replacing the bespoke
 *      `call()` helper each old .mjs script defined for itself).
 *   2. It lets UI specs arrange state cheaply — seeding a booking via
 *      HTTP is seconds faster and far less flaky than clicking through
 *      the booking flow just to get a row on the Bookings tab.
 *
 * Every method returns the parsed body plus the status, so a spec can
 * assert on failure codes without try/catch.
 */

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { API_PREFIX } from "@support/env";
import type {
  AdminStats,
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
} from "@shared/models";

export interface ApiResult<T> {
  readonly status: number;
  readonly ok: boolean;
  readonly data: T;
  /** Server-supplied message, when the request failed. */
  readonly error?: string;
}

interface CallOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly token?: string;
}

export class ApiClient {
  constructor(private readonly request: APIRequestContext) {}

  /**
   * The underlying response, for the few specs that assert on headers
   * (Cache-Control, ETag, content-type) rather than the body.
   */
  raw(
    path: string,
    opts: CallOptions & { headers?: Record<string, string> } = {},
  ): Promise<APIResponse> {
    const { method = "GET", body, token, headers = {} } = opts;
    return this.request.fetch(`${API_PREFIX}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { data: body } : {}),
    });
  }

  /** A non-/api path on the same origin, e.g. a served /uploads/ file. */
  rawAbsolute(path: string): Promise<APIResponse> {
    return this.request.fetch(path);
  }

  /** Raw call. Never throws on a non-2xx — the status is the assertion. */
  async call<T = unknown>(path: string, opts: CallOptions = {}): Promise<ApiResult<T>> {
    const { method = "GET", body, token } = opts;

    const res = await this.request.fetch(`${API_PREFIX}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { data: body } : {}),
    });

    /* Error pages and 204s are not JSON; fall back rather than throwing a
       parse error that hides the real status. */
    let parsed: unknown = {};
    try {
      parsed = await res.json();
    } catch {
      parsed = {};
    }

    const errorMessage =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : undefined;

    return {
      status: res.status(),
      ok: res.ok(),
      data: parsed as T,
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    };
  }

  /* ─── auth ────────────────────────────────────────────── */

  login(email: string, password: string) {
    return this.call<Session>("/login", { method: "POST", body: { email, password } });
  }

  /** Login that must succeed; returns the session or throws loudly. */
  async loginOrThrow(email: string, password: string): Promise<Session> {
    const res = await this.login(email, password);
    if (!res.ok) {
      throw new Error(
        `login failed for ${email}: ${res.status} ${res.error ?? "unknown error"}`,
      );
    }
    return res.data;
  }

  register(payload: { name: string; email: string; password: string; role: Role }) {
    return this.call<Session>("/register", { method: "POST", body: payload });
  }

  /**
   * Registration that must succeed. Worth using whenever a spec reads
   * straight off the result: a silent failure otherwise shows up as
   * "cannot read properties of undefined", which says nothing about the
   * 409 that actually caused it.
   */
  async registerOrThrow(payload: {
    name: string;
    email: string;
    password: string;
    role: Role;
  }): Promise<Session> {
    const res = await this.register(payload);
    if (!res.ok) {
      throw new Error(
        `register failed for ${payload.email}: ${res.status} ${res.error ?? "unknown"}`,
      );
    }
    return res.data;
  }

  me(token: string) {
    return this.call<{ user: User }>("/me", { token });
  }

  updateProfile(token: string, payload: Partial<Pick<User, "name" | "email" | "phone">>) {
    return this.call<{ user: User }>("/me", { method: "PATCH", token, body: payload });
  }

  changePassword(token: string, currentPassword: string, newPassword: string) {
    return this.call<{ ok: boolean }>("/me/password", {
      method: "POST",
      token,
      body: { currentPassword, newPassword },
    });
  }

  requestPasswordReset(email: string) {
    return this.call<PasswordResetResult>("/password-reset", {
      method: "POST",
      body: { email },
    });
  }

  authProviders() {
    return this.call<AuthProviders>("/auth/providers");
  }

  demoAccounts() {
    return this.call<{ accounts: Array<{ email: string; password: string; role: Role }> }>(
      "/demo-accounts",
    );
  }

  exchangeOAuthCode(code: string) {
    return this.call<Session>("/auth/exchange", { method: "POST", body: { code } });
  }

  /* ─── spots ───────────────────────────────────────────── */

  spots(params: { lat?: number; lng?: number; radius?: number } = {}) {
    const q = new URLSearchParams();
    if (params.lat != null && params.lng != null) {
      q.set("lat", String(params.lat));
      q.set("lng", String(params.lng));
    }
    if (params.radius != null) q.set("radius", String(params.radius));
    const qs = q.toString();
    return this.call<{ spots: Spot[] }>(`/spots${qs ? `?${qs}` : ""}`);
  }

  createSpot(token: string, payload: Record<string, unknown>) {
    return this.call<{ spot: Spot }>("/spots", { method: "POST", token, body: payload });
  }

  patchSpot(token: string, id: number, payload: Record<string, unknown>) {
    return this.call<{ spot: Spot }>(`/spots/${id}`, {
      method: "PATCH",
      token,
      body: payload,
    });
  }

  deleteSpot(token: string, id: number) {
    return this.call<{ ok: boolean }>(`/spots/${id}`, { method: "DELETE", token });
  }

  /* ─── bookings ────────────────────────────────────────── */

  bookings(token: string) {
    return this.call<{ bookings: Booking[] }>("/bookings", { token });
  }

  createBooking(
    token: string,
    payload: { spotId: number; hours: number; startAt?: string },
  ) {
    return this.call<{ booking: Booking }>("/bookings", {
      method: "POST",
      token,
      body: payload,
    });
  }

  cancelBooking(token: string, id: number) {
    return this.call<{ booking: Booking }>(`/bookings/${id}`, {
      method: "PATCH",
      token,
      body: { status: "cancelled" },
    });
  }

  extendBooking(token: string, id: number, extendHours: number) {
    return this.call<{ booking: Booking }>(`/bookings/${id}`, {
      method: "PATCH",
      token,
      body: { extendHours },
    });
  }

  /* ─── favourites ──────────────────────────────────────── */

  /**
   * All three favourite routes return the caller's full list of spot
   * IDs — `{ favourites: number[] }`, not spot objects. The client is
   * expected to intersect those ids with the spots it already has.
   */
  favourites(token: string) {
    return this.call<{ favourites: number[] }>("/favourites", { token });
  }

  addFavourite(token: string, spotId: number) {
    return this.call<{ favourites: number[] }>(`/favourites/${spotId}`, {
      method: "PUT",
      token,
    });
  }

  removeFavourite(token: string, spotId: number) {
    return this.call<{ favourites: number[] }>(`/favourites/${spotId}`, {
      method: "DELETE",
      token,
    });
  }

  /* ─── vehicles & cards ────────────────────────────────── */

  vehicles(token: string) {
    return this.call<{ vehicles: Vehicle[] }>("/vehicles", { token });
  }

  addVehicle(token: string, payload: { label: string; plate: string; type: string }) {
    return this.call<{ vehicle: Vehicle }>("/vehicles", {
      method: "POST",
      token,
      body: payload,
    });
  }

  deleteVehicle(token: string, id: number) {
    return this.call<{ ok: boolean }>(`/vehicles/${id}`, { method: "DELETE", token });
  }

  paymentMethods(token: string) {
    return this.call<{ methods: PaymentMethod[] }>("/payment-methods", { token });
  }

  addPaymentMethod(token: string, payload: Record<string, unknown>) {
    return this.call<{ method: PaymentMethod }>("/payment-methods", {
      method: "POST",
      token,
      body: payload,
    });
  }

  deletePaymentMethod(token: string, id: number) {
    return this.call<{ ok: boolean }>(`/payment-methods/${id}`, {
      method: "DELETE",
      token,
    });
  }

  /* ─── owner / admin ───────────────────────────────────── */

  ownerEarnings(token: string) {
    return this.call<OwnerEarnings>("/owner/earnings", { token });
  }

  users(token: string) {
    return this.call<{ users: User[] }>("/users", { token });
  }

  stats(token: string) {
    return this.call<AdminStats>("/stats", { token });
  }

  setUserRole(token: string, id: number, role: Role) {
    return this.call<{ user: User }>(`/users/${id}`, {
      method: "PATCH",
      token,
      body: { role },
    });
  }

  deleteUser(token: string, id: number) {
    return this.call<{ ok: boolean }>(`/users/${id}`, { method: "DELETE", token });
  }

  /* ─── spot photos ─────────────────────────────────────── */

  spotPhotos(token: string) {
    return this.call<{ photos: SpotPhoto[]; stock: string[] }>("/spot-photos", { token });
  }

  uploadSpotPhoto(token: string, dataUrl: string, label = "") {
    return this.call<{ photo: SpotPhoto; type: string }>("/spot-photos", {
      method: "POST",
      token,
      body: { dataUrl, label },
    });
  }

  deleteSpotPhoto(token: string, id: number) {
    return this.call<{ ok: boolean; fileRemoved: boolean }>(`/spot-photos/${id}`, {
      method: "DELETE",
      token,
    });
  }

  /* ─── misc ────────────────────────────────────────────── */

  places(q: string) {
    return this.call<{ places: Place[]; error?: string }>(
      `/places?q=${encodeURIComponent(q)}`,
    );
  }
}
