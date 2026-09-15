/**
 * Spots, cache headers, place search and photo upload — ports
 * e2e/features.test.mjs plus the spots half of e2e/api.test.mjs.
 */

import { spotDraft } from "@fixtures/data.fixture";
import { USERS, expect, test } from "@fixtures/index";

/** Smallest valid PNG: 1x1 with correct magic bytes. */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+bTsAAAAASUVORK5CYII=";

test.describe("GET /api/spots", () => {
  test("returns the seeded listings", async ({ api }) => {
    const res = await api.spots();
    expect(res.status).toBe(200);
    expect(res.data.spots.length).toBeGreaterThan(0);

    const spot = res.data.spots[0]!;
    expect(spot.name).toBeTruthy();
    expect(Number.isFinite(spot.lat)).toBe(true);
    expect(Number.isFinite(spot.lng)).toBe(true);
    expect(spot.price).toBeGreaterThan(0);
  });

  test("distance is null without coordinates and real with them", async ({ api }) => {
    const without = await api.spots();
    expect(without.data.spots.every((s) => s.distance === null)).toBe(true);

    /* Teynampet — the same fix the UI projects use. */
    const withCoords = await api.spots({ lat: 13.0392, lng: 80.2489 });
    expect(withCoords.data.spots.every((s) => typeof s.distance === "number")).toBe(true);

    /* And the result is sorted nearest-first. */
    const distances = withCoords.data.spots.map((s) => s.distance ?? 0);
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);
  });

  test("a radius excludes anything further away", async ({ api }) => {
    const radius = 2_000;
    const res = await api.spots({ lat: 13.0392, lng: 80.2489, radius });
    expect(res.status).toBe(200);
    expect(res.data.spots.every((s) => (s.distance ?? 0) <= radius)).toBe(true);
  });

  test("a far-away origin returns nothing within a small radius", async ({ api }) => {
    /* Delhi — the seeded listings are all Chennai, which is the "nothing
       in range" case the driver home has an empty state for. */
    const res = await api.spots({ lat: 28.6139, lng: 77.209, radius: 5_000 });
    expect(res.status).toBe(200);
    expect(res.data.spots).toHaveLength(0);
  });
});

test.describe("cache headers", () => {
  /* The 304 question: API responses must not be conditionally cached, or
     the app can be served a stale spot list. */

  test("carries no ETag and forbids storing", async ({ api }) => {
    const res = await api.raw("/spots");
    expect(res.status()).toBe(200);
    expect(res.headers()["etag"]).toBeUndefined();
    expect(res.headers()["cache-control"] ?? "").toContain("no-store");
  });

  test("a conditional GET still returns 200 with a real body", async ({ api }) => {
    const res = await api.raw("/spots", { headers: { "If-None-Match": '"anything"' } });
    expect(res.status()).toBe(200);

    const body = (await res.json()) as { spots: unknown[] };
    expect(Array.isArray(body.spots)).toBe(true);
    expect(body.spots.length).toBeGreaterThan(0);
  });

  test("repeat GETs never flip to 304", async ({ api }) => {
    for (let i = 0; i < 3; i += 1) {
      const res = await api.raw("/spots");
      expect(res.status(), `request ${i + 1} should be 200`).toBe(200);
    }
  });
});

test.describe("GET /api/places", () => {
  test("a short query returns empty without calling upstream", async ({ api }) => {
    const res = await api.places("ab");
    expect(res.data.places).toHaveLength(0);
  });

  test("a real lookup returns usable places, or degrades cleanly", async ({ api }) => {
    const res = await api.places("Anna Nagar Chennai");

    /* The geocoder is genuinely unreachable behind a TLS-inspecting
       proxy (UNABLE_TO_GET_ISSUER_CERT_LOCALLY — see the note in
       src/api.js). That is an environment fact, not a bug, so the
       requirement is that it degrades to an empty array rather than
       throwing a 500. */
    if (res.status === 503 || res.data.places.length === 0) {
      expect(Array.isArray(res.data.places)).toBe(true);
      test.info().annotations.push({
        type: "note",
        description: "geocoder unreachable from here; asserted graceful degradation",
      });
      return;
    }

    const place = res.data.places[0]!;
    expect(Number.isFinite(place.lat)).toBe(true);
    expect(Number.isFinite(place.lng)).toBe(true);
    expect(place.name).toBeTruthy();
    expect(place.label).toBeTruthy();
  });
});

test.describe("spot creation", () => {
  test("an owner can create and delete a listing", async ({ api }) => {
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);
    const draft = spotDraft();

    const created = await api.createSpot(owner.token, {
      ...draft,
      lat: 13.05,
      lng: 80.24,
      photo: "/spots/open-driveway.svg",
    });

    expect(created.status).toBe(201);
    expect(created.data.spot.name).toBe(draft.name);

    const deleted = await api.deleteSpot(owner.token, created.data.spot.id);
    expect(deleted.status).toBe(200);
  });

  test("a duplicate name and address is refused", async ({ api }) => {
    /* spots has UNIQUE (name, address) — this is the constraint the old
       drive.mjs checked by screenshotting "duplicate rejected". */
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);
    const draft = spotDraft();
    const payload = {
      ...draft,
      lat: 13.05,
      lng: 80.24,
      photo: "/spots/open-driveway.svg",
    };

    const first = await api.createSpot(owner.token, payload);
    expect(first.status).toBe(201);

    const second = await api.createSpot(owner.token, payload);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);

    await api.deleteSpot(owner.token, first.data.spot.id);
  });

  test("a driver cannot create a listing", async ({ api }) => {
    const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const res = await api.createSpot(driver.token, {
      ...spotDraft(),
      lat: 13.05,
      lng: 80.24,
      photo: "/spots/open-driveway.svg",
    });
    expect(res.status).toBe(403);
  });

  test("a listing referencing an unknown photo path is refused", async ({ api }) => {
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);
    const res = await api.createSpot(owner.token, {
      ...spotDraft(),
      lat: 13.05,
      lng: 80.24,
      photo: "/uploads/not-mine.jpg",
    });
    expect(res.status).toBe(400);
  });
});

test.describe("spot photos", () => {
  test("a driver cannot list the photo library", async ({ api }) => {
    const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    expect((await api.spotPhotos(driver.token)).status).toBe(403);
  });

  test("an owner sees their library and the stock illustrations", async ({ api }) => {
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);
    const res = await api.spotPhotos(owner.token);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.photos)).toBe(true);
    expect(res.data.stock).toHaveLength(4);
  });

  test("a real PNG uploads, is served, and can back a listing", async ({ api }) => {
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);

    const uploaded = await api.uploadSpotPhoto(owner.token, PNG_1PX, "test bay");
    expect(uploaded.status).toBe(201);
    expect(uploaded.data.photo.path).toMatch(/^\/uploads\//);
    /* Type comes from sniffing the bytes, not from the declared mime. */
    expect(uploaded.data.type).toBe("image/png");

    const served = await api.rawAbsolute(uploaded.data.photo.path);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"] ?? "").toMatch(/^image\//);

    const spot = await api.createSpot(owner.token, {
      ...spotDraft(),
      lat: 13.05,
      lng: 80.24,
      photo: uploaded.data.photo.path,
    });
    expect(spot.status).toBe(201);
    expect(spot.data.spot.photo).toBe(uploaded.data.photo.path);

    /* Cleanup, and the delete reports that the file left the disk. */
    await api.deleteSpot(owner.token, spot.data.spot.id);
    const deleted = await api.deleteSpotPhoto(owner.token, uploaded.data.photo.id);
    expect(deleted.data.ok).toBe(true);
    expect(deleted.data.fileRemoved).toBe(true);

    /* And it is really gone. */
    expect((await api.deleteSpotPhoto(owner.token, uploaded.data.photo.id)).status).toBe(
      404,
    );
  });

  test("rejects uploads that are not real images", async ({ api }) => {
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);

    /* Not a data URL at all. */
    expect(
      (await api.uploadSpotPhoto(owner.token, "http://example.com/y.png")).status,
    ).toBe(400);

    /* A data URL with no payload. */
    expect(
      (await api.uploadSpotPhoto(owner.token, "data:image/png;base64,")).status,
    ).toBe(400);

    /* Text relabelled as a PNG must fail on its bytes — 415, not 400,
       because the request was well-formed but the media was not. */
    const disguised = `data:image/png;base64,${Buffer.from(
      "this is definitely not an image",
    ).toString("base64")}`;
    expect((await api.uploadSpotPhoto(owner.token, disguised)).status).toBe(415);
  });
});
