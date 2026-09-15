import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import QRCode from "qrcode";
// Test ids come from the shared contract the Playwright locator layer
// also imports, so a rename here breaks the tests at compile time
// instead of turning into a silent locator timeout.
import { RECORD_ATTR, TID, record } from "@shared/testids";
import * as api from "./api";
import * as prefsLib from "./prefs";
import { bookingQrPayload } from "./qr";
import { COLORS, MIN_INPUT_FONT, Z, fontB, fontD } from "./theme";
import { COARSE_ACCURACY_M, FALLBACK_CENTER, VEHICLE_TYPES } from "./constants";
import {
  Badge,
  Btn,
  Field,
  Icon,
  Notice,
  Row,
  ScreenHeader,
  Select,
  Sheet,
} from "./components";
import { useBackGuard } from "./hooks/useBackGuard";
import { useGeolocation } from "./hooks/useGeolocation";
// MapView owns the main Leaflet surface. The two small inline maps below
// (the read-only one on spot detail, and the add-spot location picker)
// still compose react-leaflet directly, and reuse the price marker.
import { MapView, priceIcon } from "./map";
import { AuthScreen } from "./screens/auth";

// ─── SEARCH WITH SUGGESTIONS ────────────────────────────
// Two kinds of suggestion, because they answer different questions:
// matching listings ("take me to this spot") and matching places ("show me
// what's parking near here"). Place lookup is debounced so a free
// geocoder isn't hit on every keystroke.
const SearchBox = ({ value, onChange, spots, units, onPickSpot, onPickPlace }) => {
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const boxRef = useRef(null);

  const q = value.trim().toLowerCase();

  const spotMatches = q.length < 1 ? [] : spots
    .filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q))
    .slice(0, 4);

  useEffect(() => {
    if (q.length < 3) { setPlaces([]); setLoadingPlaces(false); return; }

    let cancelled = false;
    setLoadingPlaces(true);
    const t = setTimeout(() => {
      api.searchPlaces(q)
        .then(list => { if (!cancelled) setPlaces(list); })
        .finally(() => { if (!cancelled) setLoadingPlaces(false); });
    }, 350);

    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  // Close when tapping outside, the usual expectation for a dropdown.
  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const hasContent = spotMatches.length > 0 || places.length > 0 || loadingPlaceholder(q, loadingPlaces);
  const showDrop = open && q.length > 0 && hasContent;

  return (
    <div ref={boxRef} style={{ flex: 1, position: "relative", minWidth: 0 }}>
      <div style={{ background: COLORS.white, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <Icon name="search" size={18} color={COLORS.textTertiary} />
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search a place or spot"
          aria-label="Search for a place to park"
          data-testid={TID.searchInput}
          autoComplete="off"
          style={{ border: "none", outline: "none", fontSize: MIN_INPUT_FONT, fontFamily: fontB, flex: 1, background: "transparent", minWidth: 0 }}
        />
        {value && (
          <button
            onClick={() => { onChange(""); setPlaces([]); }}
            aria-label="Clear search"
            data-testid={TID.searchClear}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <Icon name="x" size={15} color={COLORS.textTertiary} />
          </button>
        )}
      </div>

      {showDrop && (
        <div data-testid={TID.searchDropdown} style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          background: COLORS.white, borderRadius: 12, boxShadow: "0 8px 28px rgba(13,27,42,0.18)",
          overflow: "hidden", maxHeight: 320, overflowY: "auto",
        }}>
          {spotMatches.length > 0 && (
            <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 700, color: COLORS.textTertiary, letterSpacing: 0.4 }}>
              PARKING SPOTS
            </div>
          )}
          {spotMatches.map(s => (
            <button
              key={`s${s.id}`}
              onClick={() => { onPickSpot(s); setOpen(false); }}
              data-testid={TID.searchSpotOption}
              {...record(RECORD_ATTR.spot, s.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                background: "none", border: "none", borderBottom: `1px solid ${COLORS.g100}`,
                cursor: "pointer", textAlign: "left", fontFamily: fontB, minHeight: 44,
              }}
            >
              <img src={s.photo} alt="" style={{ width: 38, height: 30, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                <span style={{ display: "block", fontSize: 11, color: COLORS.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  ₹{s.price}/hr · {prefsLib.formatDistance(s.distance, units)}
                </span>
              </span>
            </button>
          ))}

          <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 700, color: COLORS.textTertiary, letterSpacing: 0.4 }}>
            PLACES
          </div>
          {loadingPlaces && places.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: COLORS.textTertiary }}>Searching…</div>
          )}
          {!loadingPlaces && places.length === 0 && q.length >= 3 && (
            <div data-testid={TID.searchPlacesEmpty} style={{ padding: "10px 12px", fontSize: 12, color: COLORS.textTertiary }}>No matching places.</div>
          )}
          {q.length < 3 && places.length === 0 && !loadingPlaces && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: COLORS.textTertiary }}>Keep typing to search places…</div>
          )}
          {places.map(p => (
            <button
              key={`p${p.id}`}
              onClick={() => { onPickPlace(p); setOpen(false); }}
              data-testid={TID.searchPlaceOption}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                background: "none", border: "none", borderBottom: `1px solid ${COLORS.g100}`,
                cursor: "pointer", textAlign: "left", fontFamily: fontB, minHeight: 44,
              }}
            >
              <Icon name="nav" size={16} color={COLORS.teal} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ display: "block", fontSize: 11, color: COLORS.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Keeps the dropdown open while a place lookup is in flight, so it doesn't
// flicker shut between keystrokes.
const loadingPlaceholder = (q, loading) => loading || q.length >= 3;

// ─── LOCATION PANEL ─────────────────────────────────────
// Makes the position explicit: where it thinks you are, where that came
// from, and how confident it is. Without this, a wrong dot looks like a
// bug in the map rather than a poor geolocation fix.
const LocationPanel = ({
  location, source, geoStatus, scope, radiusM, picking,
  onToggleScope, onRetryGps, onStartPicking, onCancelPicking, onClearManual,
}) => {
  // minHeight keeps these comfortably tappable on a phone; 24px-tall
  // pills were well under the ~40px guidance.
  const pill = {
    padding: "9px 12px", minHeight: 40, borderRadius: 99, border: `1px solid ${COLORS.g300}`,
    background: COLORS.white, fontFamily: fontB, fontSize: 12, fontWeight: 600,
    color: COLORS.blue, cursor: "pointer", whiteSpace: "nowrap",
  };

  // Anything coarser than ~5 km is an IP-level guess, not a real fix.
  const coarse = source === "gps" && location?.accuracy != null && location.accuracy > COARSE_ACCURACY_M;

  // When a good device fix is in hand there is nothing to correct, so the
  // pin controls stay out of the way. A pinned location keeps them so it
  // can be moved or handed back to the device.
  const needsFixing = source !== "gps" || coarse;

  if (picking) {
    return (
      <div data-testid={TID.locationPickingBanner} style={{ background: "#E3F2FD", borderRadius: 10, padding: "10px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#1565C0" }}>
        <Icon name="nav" size={14} color="#1565C0" />
        <span style={{ flex: 1 }}>Tap the map to set where you are.</span>
        <button onClick={onCancelPicking} data-testid={TID.locationCancelPicking} style={pill}>Cancel</button>
      </div>
    );
  }

  return (
    <div data-testid={TID.locationPanel} style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.textSecondary }}>
        <Icon name="nav" size={14} color={location ? COLORS.textBrand : COLORS.textTertiary} />
        <span data-testid={TID.locationSummary} style={{ flex: 1, minWidth: 0 }}>
          {source === "manual" && (location.label
            ? `Showing parking near ${location.label}`
            : "Using a location you pinned")}
          {source === "gps" && "Sorted by distance from you"}
          {source === "none" && geoStatus === "denied" && "Location off — showing central Chennai."}
          {source === "none" && geoStatus === "unsupported" && "Location unavailable — showing central Chennai."}
          {source === "none" && geoStatus === "pending" && "Finding your location…"}
        </span>
        {location && (
          <button onClick={onToggleScope} data-testid={TID.locationToggleScope} style={pill}>
            {scope === "nearby" ? `Within ${radiusM / 1000} km · show all` : "Show nearby only"}
          </button>
        )}
      </div>

      {/* Exact coordinates, so a wrong-city dot is diagnosable. */}
      {location && (
        <div data-testid={TID.locationCoords} style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 3, marginLeft: 22 }}>
          {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
          {source === "gps" && location.accuracy != null &&
            ` · ±${location.accuracy >= 1000 ? `${(location.accuracy / 1000).toFixed(1)} km` : `${Math.round(location.accuracy)} m`}`}
        </div>
      )}

      {coarse && (
        <div data-testid={TID.locationCoarseWarning} style={{ background: "#FFF3E0", color: "#E65100", borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
          That fix is only accurate to ±{(location.accuracy / 1000).toFixed(0)} km, so it came from your
          network rather than GPS and may show the wrong area. Pin your
          location to correct it.
        </div>
      )}

      {/* Correction controls appear only when there's something to correct.
          Shown unconditionally they cost ~50px of vertical space and push
          the first spot card below the fold on a small phone. */}
      {needsFixing && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, marginLeft: 22, flexWrap: "wrap" }}>
          <button onClick={onStartPicking} data-testid={TID.locationSetPin} style={pill}>
            {source === "manual" ? "Move my pin" : "Set my location"}
          </button>
          {source === "manual" && <button onClick={onClearManual} data-testid={TID.locationClearPin} style={pill}>Use device location</button>}
          {source === "none" && geoStatus !== "pending" && (
            <button onClick={onRetryGps} data-testid={TID.locationRetryGps} style={pill}>Try device location</button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── SPOT CARD ──────────────────────────────────────────
const SpotCard = ({ spot, onClick, units = "km", isFavourite, onToggleFavourite }) => (
  <div onClick={onClick} data-testid={TID.spotCard} {...record(RECORD_ATTR.spot, spot.id)} style={{ display: "flex", gap: 12, padding: 14, borderRadius: 12, border: `1px solid ${COLORS.g200}`, cursor: "pointer", transition: "all 0.15s", background: COLORS.white, marginBottom: 10 }}>
    <img
      src={spot.photo}
      alt={`${spot.type} parking at ${spot.name}`}
      loading="lazy"
      style={{ width: 84, height: 68, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: COLORS.g100 }}
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy, fontFamily: fontB }}>{spot.name}</span>
        {spot.verified && <Badge color="green">✓</Badge>}
        {onToggleFavourite && (
          <button
            aria-label={isFavourite ? "Remove from saved" : "Save this spot"}
            data-testid={TID.spotCardFavourite}
            onClick={e => { e.stopPropagation(); onToggleFavourite(spot); }}
            style={{
              marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
              lineHeight: 1, flexShrink: 0,
              // Padded out to a 40px tap area without growing the glyph.
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              margin: "-8px -8px -8px auto",
            }}
          >
            <span style={{ fontSize: 16, filter: isFavourite ? "none" : "grayscale(1)", opacity: isFavourite ? 1 : 0.35 }}>
              {isFavourite ? "❤️" : "🤍"}
            </span>
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>{spot.address}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: fontD, fontSize: 15, fontWeight: 700, color: COLORS.navy, background: "#E8FAF0", padding: "2px 8px", borderRadius: 6 }}>₹{spot.price}/hr</span>
        <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{prefsLib.formatDistance(spot.distance, units)}</span>
        <span style={{ fontSize: 12, color: COLORS.textWarning }}>★ {spot.rating || "new"}</span>
        <Badge color="gray">{spot.type}</Badge>
      </div>
    </div>
  </div>
);

// ─── DETAIL SCREEN ──────────────────────────────────────
const DetailScreen = ({ spot, onBack, onBook, units = "km", defaultHours = 2, isFavourite, onToggleFavourite, booking: bookingState }) => {
  const [hours, setHours] = useState(defaultHours);
  const [shared, setShared] = useState("");
  const total = Math.round(spot.price * hours * 1.1);

  useBackGuard(true, onBack);

  // Web Share API where available (mobile, some desktop), clipboard
  // fallback everywhere else so the button always does something.
  const share = async () => {
    const url = `${window.location.origin}/?spot=${spot.id}`;
    const payload = { title: spot.name, text: `${spot.name} — ₹${spot.price}/hr on ParkSpace`, url };
    try {
      if (navigator.share) { await navigator.share(payload); setShared("Shared"); }
      else { await navigator.clipboard.writeText(url); setShared("Link copied"); }
    } catch {
      setShared("Couldn't share");
    }
    setTimeout(() => setShared(""), 2200);
  };

  return (
    <div className="ps-screen-h" data-testid={TID.spotDetail} {...record(RECORD_ATTR.spot, spot.id)} style={{ display: "flex", flexDirection: "column", background: COLORS.white }}>
      <div style={{ position: "relative", height: 220, flexShrink: 0, background: COLORS.g200 }}>
        <img src={spot.photo} alt={`${spot.type} parking at ${spot.name}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {/* Solid white pill rather than a translucent circle: a low-contrast
            glyph over an arbitrary photo was easy to miss entirely. */}
        <button
          onClick={onBack}
          aria-label="Back to spot list"
          style={{
            position: "absolute", top: 14, left: 14, display: "flex", alignItems: "center", gap: 6,
            padding: "9px 14px 9px 10px", borderRadius: 99, background: COLORS.white, border: "none",
            cursor: "pointer", boxShadow: "0 2px 10px rgba(13,27,42,0.28)",
            fontFamily: fontB, fontSize: 14, fontWeight: 600, color: COLORS.navy,
          }}
        >
          <Icon name="back" size={18} color={COLORS.navy} />
          Back
        </button>
        <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 8 }}>
          <button onClick={share} aria-label="Share this spot" style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(13,27,42,0.55)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="share" size={18} color="white" />
          </button>
          {onToggleFavourite && (
            <button onClick={() => onToggleFavourite(spot)} aria-label={isFavourite ? "Remove from saved" : "Save this spot"} data-testid={TID.detailFavourite} style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(13,27,42,0.55)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>
              {isFavourite ? "❤️" : "🤍"}
            </button>
          )}
        </div>
        {shared && (
          <div style={{ position: "absolute", top: 62, right: 16, background: COLORS.navy, color: "white", fontSize: 11, padding: "5px 10px", borderRadius: 7 }}>{shared}</div>
        )}
        <div style={{ position: "absolute", bottom: 12, left: 16, display: "flex", gap: 6 }}>
          {spot.verified && <Badge color="green">✓ Verified</Badge>}
          <Badge color="blue">{spot.type}</Badge>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 20px 120px" }}>
        <div data-testid={TID.detailName} style={{ fontFamily: fontD, fontSize: 22, fontWeight: 700, color: COLORS.navy }}>{spot.name}</div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
          {spot.address}{spot.distance != null && ` — ${prefsLib.formatDistance(spot.distance, units)} away`}
        </div>

        {/* Static mini-map so the driver can see exactly where the spot is. */}
        <div style={{ height: 160, borderRadius: 12, overflow: "hidden", border: `1px solid ${COLORS.g200}`, marginBottom: 4 }}>
          <MapContainer
            center={[spot.lat, spot.lng]}
            zoom={16}
            zoomControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            attributionControl={false}
            style={{ width: "100%", height: "100%" }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
            <Marker position={[spot.lat, spot.lng]} icon={priceIcon(spot, true)} />
          </MapContainer>
        </div>
        <div style={{ fontSize: 10, color: COLORS.textTertiary, marginBottom: 16, textAlign: "right" }}>
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{ color: COLORS.textSecondary }}>OpenStreetMap</a> contributors
        </div>

        {[
          { icon: "clock", label: "Availability", value: spot.available },
          { icon: "car", label: "Vehicle type", value: spot.vehicle },
          { icon: "shield", label: "Trust score", value: `★ ${spot.rating} — ${spot.reviews} bookings` },
          { icon: "user", label: "Owner", value: `${spot.owner} — since ${spot.since}` },
        ].map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: i < 3 ? `1px solid ${COLORS.g100}` : "none" }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: COLORS.g100, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={r.icon} size={18} color={COLORS.blue} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{r.label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy }}>{r.value}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.g700, display: "block", marginBottom: 8 }}>Duration (hours)</label>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => setHours(Math.max(1, hours - 1))} aria-label="Decrease duration" data-testid={TID.detailHoursDecrease} style={{ width: 40, height: 40, borderRadius: 10, border: `1.5px solid ${COLORS.g300}`, background: "white", fontSize: 20, cursor: "pointer" }}>−</button>
            <span data-testid={TID.detailHours} style={{ fontFamily: fontD, fontSize: 28, fontWeight: 700, color: COLORS.navy, minWidth: 40, textAlign: "center" }}>{hours}</span>
            <button onClick={() => setHours(Math.min(12, hours + 1))} aria-label="Increase duration" data-testid={TID.detailHoursIncrease} style={{ width: 40, height: 40, borderRadius: 10, border: `1.5px solid ${COLORS.g300}`, background: "white", fontSize: 20, cursor: "pointer" }}>+</button>
            <span style={{ fontSize: 13, color: COLORS.textSecondary }}>₹{spot.price} × {hours}h + 10% fee</span>
          </div>
        </div>
      </div>
      <div className="ps-actionbar" style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 16px 0", background: COLORS.white, borderTop: `1px solid ${COLORS.g200}`, zIndex: Z.screenBar }}>
        {bookingState?.error && <Notice>{bookingState.error}</Notice>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div data-testid={TID.detailTotal} style={{ fontFamily: fontD, fontSize: 26, fontWeight: 700, color: COLORS.navy }}>₹{total}</div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{hours} hour{hours > 1 ? "s" : ""} total</div>
          </div>
          <Btn
            size="lg"
            testId={TID.detailBook}
            onClick={bookingState?.busy ? undefined : () => onBook(spot, hours)}
            style={bookingState?.busy ? { opacity: 0.6, cursor: "wait" } : undefined}
          >
            {bookingState?.busy ? "Booking…" : "Book now"}
          </Btn>
        </div>
      </div>
    </div>
  );
};

// ─── CONFIRM BOOKING ────────────────────────────────────
// Booking takes money and commits a slot, so it gets an explicit review
// step rather than firing straight off a single tap.
const ConfirmBookingSheet = ({ spot, hours, units, busy, error, onCancel, onConfirm }) => {
  const subtotal = spot.price * hours;
  const fee = Math.round(subtotal * 0.1);
  const total = Math.round(subtotal * 1.1);

  const row = (label, value, strong) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", fontSize: strong ? 15 : 13 }}>
      <span style={{ color: strong ? COLORS.g700 : COLORS.textSecondary, fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ color: COLORS.navy, fontWeight: strong ? 700 : 600, fontFamily: strong ? fontD : fontB, textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <Sheet
      title="Confirm your booking"
      subtitle="Check the details before you book."
      onClose={busy ? () => {} : onCancel}
      testId={TID.confirmSheet}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="ghost" full testId={TID.confirmCancel} onClick={busy ? undefined : onCancel}>Back</Btn>
          <Btn full testId={TID.confirmSubmit} onClick={busy ? undefined : onConfirm} style={busy ? { opacity: 0.6, cursor: "wait" } : undefined}>
            {busy ? "Booking…" : `Confirm · ₹${total}`}
          </Btn>
        </div>
      }
    >
      {error && <div data-testid={TID.confirmError}><Notice>{error}</Notice></div>}

      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <img src={spot.photo} alt={`${spot.type} parking at ${spot.name}`} style={{ width: 84, height: 66, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: COLORS.g100 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.navy }}>{spot.name}</div>
          <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{spot.address}</div>
          {spot.distance != null && (
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
              {prefsLib.formatDistance(spot.distance, units)} away
            </div>
          )}
        </div>
      </div>

      <div style={{ background: COLORS.g50, borderRadius: 12, padding: "6px 14px", marginBottom: 14 }}>
        {row("Duration", `${hours} hour${hours > 1 ? "s" : ""}`)}
        {row("Starts", "Now")}
        {row("Spot type", `${spot.type} · ${spot.vehicle}`)}
        {row("Availability", spot.available)}
        <div style={{ height: 1, background: COLORS.g200, margin: "6px 0" }} />
        {row(`₹${spot.price}/hr × ${hours}h`, `₹${subtotal}`)}
        {row("Service fee (10%)", `₹${fee}`)}
        <div data-testid={TID.confirmTotal}>{row("Total", `₹${total}`, true)}</div>
      </div>

      <Notice tone="info">
        Demo booking — no payment is taken. You can cancel or extend it
        afterwards from the Bookings tab.
      </Notice>
    </Sheet>
  );
};

// ─── BOOKING QR ─────────────────────────────────────────
// A genuinely scannable code carrying the booking reference and spot, so
// an attendant's phone reads something meaningful. This replaces a
// hard-coded pixel pattern that looked like a QR but decoded to nothing.
const BookingQr = ({ booking }) => {
  const [src, setSrc] = useState("");
  const [err, setErr] = useState(false);
  const [showText, setShowText] = useState(false);

  const payload = bookingQrPayload(booking, window.location.origin);

  useEffect(() => {
    let cancelled = false;
    // Level M keeps the code readable after a bit of print wear while
    // still fitting this much text.
    QRCode.toDataURL(payload, {
      width: 480, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#0D1B2A", light: "#FFFFFF" },
    })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [payload]);

  return (
    <div data-testid={TID.confirmQr} style={{ textAlign: "center", marginBottom: 24 }}>
      <div style={{ width: 172, height: 172, border: `2px solid ${COLORS.g200}`, borderRadius: 12, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: COLORS.white }}>
        {src
          ? <img src={src} alt={`QR code for booking ${booking.ref}`} style={{ width: 160, height: 160, display: "block" }} />
          : <span style={{ fontSize: 11, color: COLORS.textTertiary }}>{err ? "QR unavailable" : "…"}</span>}
      </div>
      <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 6, fontFamily: "monospace" }}>{booking.ref}</div>
      <button
        onClick={() => setShowText(v => !v)}
        style={{ marginTop: 8, minHeight: 40, padding: "9px 14px", background: "none", border: `1px solid ${COLORS.g300}`, borderRadius: 99, fontFamily: fontB, fontSize: 12, fontWeight: 600, color: COLORS.blue, cursor: "pointer" }}
      >
        {showText ? "Hide encoded details" : "What's in this code?"}
      </button>
      {showText && (
        <pre style={{
          textAlign: "left", background: COLORS.g50, border: `1px solid ${COLORS.g200}`, borderRadius: 10,
          padding: 12, marginTop: 10, fontSize: 10.5, lineHeight: 1.5, color: COLORS.g700,
          whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace",
        }}>{payload}</pre>
      )}
    </div>
  );
};

// ─── BOOKING CONFIRMATION ───────────────────────────────
const ConfirmScreen = ({ booking, onDone }) => {
  useBackGuard(true, onDone);

  return (
  <div className="ps-screen-min-h" data-testid={TID.confirmScreen} {...record(RECORD_ATTR.booking, booking.id)} style={{ background: COLORS.white }}>
    <div style={{ position: "relative", background: COLORS.mint, padding: "48px 20px 32px", textAlign: "center" }}>
      {/* Previously the only way out was the "Done" button far below the
          fold; Back and this close button now both work. */}
      <button
        onClick={onDone}
        aria-label="Close and return to spots"
        style={{
          position: "absolute", top: 14, right: 14, width: 38, height: 38, borderRadius: "50%",
          background: "rgba(255,255,255,0.9)", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon name="x" size={18} color={COLORS.navy} />
      </button>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "white", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="check" size={32} color={COLORS.textBrand} />
      </div>
      <div style={{ fontFamily: fontD, fontSize: 24, fontWeight: 700, color: COLORS.navy }}>Booking confirmed</div>
      <div style={{ fontSize: 14, color: COLORS.blue, marginTop: 4 }}>Your spot is reserved</div>
    </div>
    <div style={{ padding: 20 }}>
      <div style={{ background: COLORS.g50, borderRadius: 14, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            ["Location", booking.spot.name], ["Spot type", booking.spot.type],
            ["Date", booking.date], ["Time", booking.time],
            ["Duration", `${booking.hours} hours`],
            // The reference is the one field a test needs to correlate this
            // screen with a row on the Bookings tab. The id wraps the bare
            // reference, not the "#" prefix, so the string can be matched
            // against the API's booking.ref without trimming.
            ["Booking ID", <>#<span data-testid={TID.confirmRef}>{booking.ref}</span></>],
          ].map(([l, v], i) => (
            <div key={i}><div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy }}>{v}</div></div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0 0", borderTop: `2px dashed ${COLORS.g200}`, marginTop: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.g700 }}>Total paid</span>
          <span style={{ fontFamily: fontD, fontSize: 22, fontWeight: 700, color: COLORS.navy }}>₹{booking.total}</span>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 }}>Scan QR code at the spot</div>
      <BookingQr booking={booking} />
      <div style={{ display: "flex", gap: 10 }}>
        <Btn
          variant="secondary"
          full
          onClick={() => window.open(
            `https://www.openstreetmap.org/directions?to=${booking.spot.lat},${booking.spot.lng}`,
            "_blank", "noopener"
          )}
        >
          Get directions
        </Btn>
        <Btn variant="outline" full testId={TID.confirmDone} onClick={onDone}>Done</Btn>
      </div>
    </div>
  </div>
  );
};

// ─── FILTER SHEET ───────────────────────────────────────
const FilterSheet = ({ value, onChange, onClose, maxPriceSeen }) => {
  const [draft, setDraft] = useState(value);
  const cap = Math.max(60, Math.ceil(maxPriceSeen / 10) * 10);

  return (
    <Sheet
      title="Filters & sorting"
      onClose={onClose}
      testId={TID.filterSheet}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="ghost" full testId={TID.filterReset} onClick={() => setDraft({ maxPrice: 0, verifiedOnly: false, sort: "distance" })}>Reset</Btn>
          <Btn full testId={TID.filterApply} onClick={() => { onChange(draft); onClose(); }}>Apply</Btn>
        </div>
      }
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.g700, display: "block", marginBottom: 6 }}>
        Max price {draft.maxPrice > 0 ? `— ₹${draft.maxPrice}/hr` : "— any"}
      </span>
      <input
        type="range" min="0" max={cap} step="5"
        value={draft.maxPrice}
        onChange={e => setDraft(d => ({ ...d, maxPrice: Number(e.target.value) }))}
        aria-label="Maximum price per hour"
        aria-valuetext={draft.maxPrice > 0 ? `₹${draft.maxPrice} per hour` : "any price"}
        data-testid={TID.filterMaxPrice}
        style={{ width: "100%", marginBottom: 18 }}
      />

      <Select
        label="Sort by"
        value={draft.sort}
        onChange={e => setDraft(d => ({ ...d, sort: e.target.value }))}
        data-testid={TID.filterSort}
        options={[
          { value: "distance", label: "Nearest first" },
          { value: "price", label: "Cheapest first" },
          { value: "rating", label: "Highest rated" },
        ]}
      />

      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 0" }}>
        <input
          type="checkbox"
          checked={draft.verifiedOnly}
          onChange={e => setDraft(d => ({ ...d, verifiedOnly: e.target.checked }))}
          data-testid={TID.filterVerifiedOnly}
          style={{ width: 18, height: 18, cursor: "pointer" }}
        />
        <span style={{ fontSize: 14, color: COLORS.navy }}>Verified spots only</span>
      </label>
    </Sheet>
  );
};

// ─── EDIT PROFILE ───────────────────────────────────────
const EditProfileSheet = ({ user, token, onClose, onSaved }) => {
  const [form, setForm] = useState({ name: user.name, email: user.email, phone: user.phone || "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const saveProfile = async () => {
    setErr(""); setMsg(null); setBusy(true);
    try {
      const d = await api.updateProfile(token, form);
      // The token embeds the email, so the server issues a fresh one.
      onSaved(d);
      setMsg("Profile saved.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setErr(""); setMsg(null); setBusy(true);
    try {
      await api.changePassword(token, pw.currentPassword, pw.newPassword);
      setPw({ currentPassword: "", newPassword: "" });
      setMsg("Password updated.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Edit profile"
      onClose={onClose}
      testId={TID.editProfileSheet}
      footer={<Btn full size="lg" testId={TID.editProfileSave} onClick={busy ? undefined : saveProfile} style={busy ? { opacity: 0.6 } : undefined}>{busy ? "Saving…" : "Save changes"}</Btn>}
    >
      {err && <div data-testid={TID.editProfileError}><Notice>{err}</Notice></div>}
      {msg && <Notice tone="success">{msg}</Notice>}

      <Field label="Full name" value={form.name} onChange={set("name")} data-testid={TID.editProfileName} />
      <Field label="Email" type="email" value={form.email} onChange={set("email")} data-testid={TID.editProfileEmail} />
      <Field label="Phone" value={form.phone} onChange={set("phone")} placeholder="+91 98400 00000" data-testid={TID.editProfilePhone} />

      <div style={{ height: 1, background: COLORS.g200, margin: "6px 0 18px" }} />
      <div style={{ fontFamily: fontD, fontSize: 15, fontWeight: 600, color: COLORS.navy, marginBottom: 12 }}>Change password</div>
      <Field label="Current password" type="password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} />
      <Field label="New password" type="password" value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} hint="At least 6 characters." />
      <Btn variant="outline" full onClick={busy ? undefined : savePassword}>Update password</Btn>
    </Sheet>
  );
};

// ─── VEHICLES ───────────────────────────────────────────

const VehiclesSheet = ({ token, onClose }) => {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ label: "", plate: "", type: "Sedan" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // Same reasoning as CardsSheet: a late-arriving initial load must not
  // erase an error raised by something the user did in the meantime.
  const load = useCallback(() => {
    api.getVehicles(token)
      .then(d => setList(d.vehicles))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  const add = async () => {
    setErr("");
    try {
      const d = await api.addVehicle(token, form);
      setList(prev => [...prev, d.vehicle]);
      setForm({ label: "", plate: "", type: "Sedan" });
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (v) => {
    try {
      await api.deleteVehicle(token, v.id);
      setList(prev => prev.filter(x => x.id !== v.id));
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Sheet title="My vehicles" subtitle="Used to match spots that fit your vehicle." onClose={onClose}
      testId={TID.vehiclesSheet}
      footer={<Btn full size="lg" testId={TID.vehicleAdd} onClick={add}>Add vehicle</Btn>}>
      {err && <Notice>{err}</Notice>}
      {loading && <div style={{ color: COLORS.textTertiary, fontSize: 14, padding: "8px 0" }}>Loading…</div>}
      {!loading && list.length === 0 && (
        <div data-testid={TID.vehiclesEmpty} style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 14 }}>No vehicles saved yet.</div>
      )}
      {list.map(v => (
        <Row
          key={v.id}
          testId={TID.vehicleRow}
          dataAttrs={record(RECORD_ATTR.vehicle, v.id)}
          icon="car"
          label={v.label}
          value={`${v.plate} · ${v.type}`}
          right={
            <button onClick={() => remove(v)} aria-label={`Remove ${v.label}`} data-testid={TID.vehicleDelete} style={{ background: "none", border: "none", cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="x" size={15} color={COLORS.textTertiary} />
            </button>
          }
        />
      ))}
      <div style={{ height: 1, background: COLORS.g200, margin: "18px 0" }} />
      <Field label="Model" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Hyundai i20" data-testid={TID.vehicleLabel} />
      <Field label="Plate number" value={form.plate} onChange={e => setForm(f => ({ ...f, plate: e.target.value }))} placeholder="TN 09 BX 4412" data-testid={TID.vehiclePlate} />
      <Select label="Type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} options={VEHICLE_TYPES} data-testid={TID.vehicleType} />
    </Sheet>
  );
};

// ─── PAYMENT METHODS ────────────────────────────────────
const CardsSheet = ({ token, onClose }) => {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ number: "", exp: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // Deliberately does NOT clear `err` on success. This runs once on mount,
  // and on a slow connection its response can land *after* the user has
  // already submitted a bad card — clearing the error here then wipes the
  // "that card was rejected" message they need to see. Errors are cleared
  // by the next user action instead (see add/remove below).
  const load = useCallback(() => {
    api.getPaymentMethods(token)
      .then(d => setList(d.methods))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  const add = async () => {
    setErr("");
    try {
      const d = await api.addPaymentMethod(token, form);
      setList(prev => [...prev, d.method]);
      setForm({ number: "", exp: "" });
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (m) => {
    try {
      await api.deletePaymentMethod(token, m.id);
      setList(prev => prev.filter(x => x.id !== m.id));
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Sheet title="Payment methods" onClose={onClose}
      testId={TID.cardsSheet}
      footer={<Btn full size="lg" testId={TID.cardAdd} onClick={add}>Add card</Btn>}>
      <Notice tone="info">
        Demo only — no gateway is connected and no charge is ever made. Only the
        brand, last four digits and expiry are stored; the number is validated
        then discarded.
      </Notice>
      {err && <div data-testid={TID.cardError}><Notice>{err}</Notice></div>}
      {loading && <div style={{ color: COLORS.textTertiary, fontSize: 14, padding: "8px 0" }}>Loading…</div>}
      {!loading && list.length === 0 && (
        <div style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 14 }}>No cards saved yet.</div>
      )}
      {list.map(m => (
        <Row
          key={m.id}
          testId={TID.cardRow}
          dataAttrs={record(RECORD_ATTR.card, m.id)}
          icon="cash"
          label={`${m.brand} •••• ${m.last4}`}
          value={`Expires ${m.exp}`}
          right={
            <button onClick={() => remove(m)} aria-label={`Remove card ending ${m.last4}`} data-testid={TID.cardDelete} style={{ background: "none", border: "none", cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="x" size={15} color={COLORS.textTertiary} />
            </button>
          }
        />
      ))}
      <div style={{ height: 1, background: COLORS.g200, margin: "18px 0" }} />
      <Field
        label="Card number"
        value={form.number}
        onChange={e => setForm(f => ({ ...f, number: e.target.value }))}
        placeholder="4242 4242 4242 4242"
        inputMode="numeric"
        hint="Try 4242 4242 4242 4242 — must pass the Luhn checksum."
        data-testid={TID.cardNumber}
      />
      <Field label="Expiry (MM/YY)" value={form.exp} onChange={e => setForm(f => ({ ...f, exp: e.target.value }))} placeholder="11/28" data-testid={TID.cardExpiry} />
    </Sheet>
  );
};

// ─── SETTINGS ───────────────────────────────────────────
const SettingsSheet = ({ prefs, onSave, onClose, onPickLocation }) => {
  const [draft, setDraft] = useState(prefs);

  return (
    <Sheet
      title="Settings"
      subtitle="These genuinely change how search and booking behave."
      onClose={onClose}
      testId={TID.settingsSheet}
      footer={<Btn full size="lg" testId={TID.settingsSave} onClick={() => { onSave(draft); onClose(); }}>Save settings</Btn>}
    >
      <Select
        label="Nearby search radius"
        value={String(draft.radiusM)}
        onChange={e => setDraft(d => ({ ...d, radiusM: Number(e.target.value) }))}
        data-testid={TID.settingsRadius}
        options={[
          { value: "1000", label: "1 km" }, { value: "3000", label: "3 km" },
          { value: "5000", label: "5 km" }, { value: "10000", label: "10 km" },
        ]}
      />
      <Select
        label="Default booking duration"
        value={String(draft.defaultHours)}
        onChange={e => setDraft(d => ({ ...d, defaultHours: Number(e.target.value) }))}
        data-testid={TID.settingsDefaultHours}
        options={[1, 2, 3, 4, 6, 8].map(h => ({ value: String(h), label: `${h} hour${h > 1 ? "s" : ""}` }))}
      />
      <Select
        label="Distance units"
        value={draft.units}
        onChange={e => setDraft(d => ({ ...d, units: e.target.value }))}
        data-testid={TID.settingsUnits}
        options={[{ value: "km", label: "Kilometres" }, { value: "mi", label: "Miles" }]}
      />
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 0" }}>
        <input
          type="checkbox"
          checked={draft.showUnverified}
          onChange={e => setDraft(d => ({ ...d, showUnverified: e.target.checked }))}
          style={{ width: 18, height: 18, cursor: "pointer" }}
        />
        <span style={{ fontSize: 14, color: COLORS.navy }}>Show spots awaiting verification</span>
      </label>
      {/* Always-available entry point for pinning a position. The inline
          control on the map screen only appears when the device fix is
          missing or coarse, so this keeps it discoverable. */}
      <Row
        testId={TID.settingsPickLocation}
        icon="nav"
        label={prefs.manualLocation ? "Move my pinned location" : "Set my location manually"}
        value={prefs.manualLocation
          ? `${prefs.manualLocation.lat.toFixed(4)}, ${prefs.manualLocation.lng.toFixed(4)}`
          : "Tap the map to place yourself"}
        onClick={() => { onClose(); onPickLocation(); }}
      />
      {prefs.manualLocation && (
        <Row
          testId={TID.settingsClearLocation}
          icon="x"
          label="Clear pinned location"
          value="Go back to the device's own position"
          onClick={() => { onSave({ ...draft, manualLocation: null }); onClose(); }}
        />
      )}

      <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 10 }}>
        Saved to this browser only.
      </div>
    </Sheet>
  );
};

// ─── SAFETY & PRIVACY ───────────────────────────────────
const SafetySheet = ({ user, onClose, onSignOut }) => (
  <Sheet title="Safety and privacy" onClose={onClose} testId={TID.safetySheet}>
    <div style={{ fontFamily: fontD, fontSize: 15, fontWeight: 600, color: COLORS.navy, marginBottom: 8 }}>What this app stores</div>
    <div style={{ fontSize: 13, color: COLORS.g600, lineHeight: 1.6, marginBottom: 18 }}>
      Your name, email, phone, vehicles, bookings and saved spots are held in a
      local SQLite database on this machine. Passwords are stored only as
      scrypt hashes, never in plain text. Card numbers are never stored — only
      the brand, last four digits and expiry.
    </div>

    <div style={{ fontFamily: fontD, fontSize: 15, fontWeight: 600, color: COLORS.navy, marginBottom: 8 }}>Location</div>
    <div style={{ fontSize: 13, color: COLORS.g600, lineHeight: 1.6, marginBottom: 18 }}>
      Your position is requested once per session to sort spots by distance. It
      is sent to the local API to compute distances and is never stored. Deny
      the browser prompt and the app falls back to central Chennai.
    </div>

    <Notice tone="info">
      This is a demo build. The session token is unsigned and social sign-in is
      simulated, so don't use real credentials or card numbers.
    </Notice>

    <Row icon="user" label="Signed in as" value={`${user.email} · ${user.role}`} />
    <Row
      icon="settings"
      label="Clear local preferences"
      value="Resets radius, units and duration"
      onClick={() => { prefsLib.save({ ...prefsLib.DEFAULTS }); window.location.reload(); }}
    />
    <div style={{ marginTop: 20 }}>
      <Btn variant="danger" full onClick={onSignOut}>
        <Icon name="logout" size={17} color="white" /> Sign out of this device
      </Btn>
    </div>
  </Sheet>
);

// ─── ADD SPOT ───────────────────────────────────────────
const SPOT_PHOTOS = [
  { src: "/spots/covered-garage.svg", label: "Covered garage" },
  { src: "/spots/open-driveway.svg", label: "Open driveway" },
  { src: "/spots/basement-lot.svg", label: "Basement lot" },
  { src: "/spots/gated-compound.svg", label: "Gated compound" },
];

// Click-to-place location picker: typing raw coordinates is not something
// an owner should have to do.
const LocationPicker = ({ value, onChange }) => {
  useMapEvents({ click: (e) => onChange({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  // Leaflet drops an empty alt, leaving the attribute off entirely, so
  // give the marker a real description.
  return <Marker position={[value.lat, value.lng]} alt="Selected spot location" />;
};

// Downscale before upload: a phone photo is several MB and 1280px wide is
// plenty for a listing thumbnail, so this keeps uploads fast and well
// inside the server's size limit.
const shrinkImage = (file, maxEdge = 1280, quality = 0.82) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a readable image."));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        // JPEG: photos compress far better than PNG and the server
        // accepts jpg/png/webp.
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

// Photo chooser: capture with the camera, pick a file, reuse an earlier
// upload, or fall back to one of the bundled illustrations.
const SpotPhotoPicker = ({ token, value, onChange }) => {
  const [mine, setMine] = useState([]);
  const [stock, setStock] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cameraRef = useRef(null);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    api.getSpotPhotos(token)
      .then(d => { setMine(d.photos); setStock(d.stock ?? []); })
      .catch(e => setErr(e.message));
  }, [token]);

  useEffect(load, [load]);

  const handleFile = async (file) => {
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      const dataUrl = await shrinkImage(file);
      const d = await api.uploadSpotPhoto(token, dataUrl, file.name?.slice(0, 60) ?? "");
      setMine(prev => [d.photo, ...prev]);
      onChange(d.photo.path);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeMine = async (photo) => {
    setErr("");
    try {
      await api.deleteSpotPhoto(token, photo.id);
      setMine(prev => prev.filter(p => p.id !== photo.id));
      if (value === photo.path) onChange(stock[0] ?? "");
    } catch (e) {
      setErr(e.message);
    }
  };

  const tile = (selected) => ({
    padding: 0, border: selected ? `2.5px solid ${COLORS.mint}` : `1.5px solid ${COLORS.g300}`,
    borderRadius: 9, overflow: "hidden", cursor: "pointer", background: "none", lineHeight: 0,
    position: "relative",
  });

  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.g700, display: "block", marginBottom: 6 }}>
        Photo of the space
      </span>
      {err && <Notice>{err}</Notice>}

      {/* `capture` asks a phone to open the camera directly; on desktop
          both inputs fall back to a file chooser. */}
      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment"
        onChange={e => handleFile(e.target.files?.[0])} style={{ display: "none" }}
      />
      <input
        ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={e => handleFile(e.target.files?.[0])} style={{ display: "none" }}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Btn size="sm" variant="secondary" onClick={() => !busy && cameraRef.current?.click()}>
          <Icon name="photo" size={15} color="white" /> {busy ? "Uploading…" : "Take photo"}
        </Btn>
        <Btn size="sm" variant="outline" onClick={() => !busy && fileRef.current?.click()}>
          Choose file
        </Btn>
      </div>

      {mine.length > 0 && (
        <>
          <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textTertiary, display: "block", marginBottom: 6, letterSpacing: 0.3 }}>
            YOUR PHOTOS — tap to reuse
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
            {mine.map(p => (
              <div key={p.id} style={{ position: "relative" }}>
                <button onClick={() => onChange(p.path)} title={p.label || "Your photo"} style={{ ...tile(value === p.path), width: "100%" }}>
                  <img src={p.path} alt={p.label || "Uploaded parking photo"} style={{ width: "100%", height: 52, objectFit: "cover", display: "block" }} />
                </button>
                <button
                  onClick={() => removeMine(p)}
                  aria-label={`Delete photo ${p.label || p.id}`}
                  style={{
                    position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%",
                    background: COLORS.white, border: `1px solid ${COLORS.g300}`, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                  }}
                >
                  <Icon name="x" size={11} color={COLORS.textError} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textTertiary, display: "block", marginBottom: 6, letterSpacing: 0.3 }}>
        OR USE AN ILLUSTRATION
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {stock.map(src => {
          // "/spots/covered-garage.svg" -> "Covered garage"
          const label = src.split("/").pop().replace(/\.svg$/, "").replace(/-/g, " ");
          return (
            <button
              key={src}
              onClick={() => onChange(src)}
              aria-label={`Use the ${label} illustration`}
              aria-pressed={value === src}
              title={label}
              data-testid={TID.addSpotPhoto}
              style={tile(value === src)}
            >
              <img src={src} alt="" style={{ width: "100%", height: 46, objectFit: "cover", display: "block" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const AddSpotSheet = ({ token, onClose, onCreated }) => {
  const [form, setForm] = useState({
    name: "", address: "", type: "Covered", vehicle: "Sedan/SUV",
    price: "40", available: "Daily, 8 AM – 8 PM", photo: SPOT_PHOTOS[0].src,
  });
  const [coords, setCoords] = useState(FALLBACK_CENTER);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const { spot } = await api.createSpot(token, {
        ...form,
        price: Number(form.price),
        lat: coords.lat,
        lng: coords.lng,
      });
      onCreated(spot);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Add a parking spot"
      subtitle="It goes live immediately, pending admin verification."
      onClose={onClose}
      testId={TID.addSpotSheet}
      footer={
        <Btn full size="lg" testId={TID.addSpotSubmit} onClick={busy ? undefined : submit} style={busy ? { opacity: 0.6, cursor: "wait" } : undefined}>
          {busy ? "Publishing…" : "Publish listing"}
        </Btn>
      }
    >
      {err && <div data-testid={TID.addSpotError}><Notice>{err}</Notice></div>}

      <Field label="Listing name" value={form.name} onChange={set("name")} placeholder="e.g. Lakshmi Residency" data-testid={TID.addSpotName} />
      <Field label="Address" value={form.address} onChange={set("address")} placeholder="14 Gandhi St, T. Nagar" data-testid={TID.addSpotAddress} />

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Select label="Type" value={form.type} onChange={set("type")} options={["Covered", "Open"]} data-testid={TID.addSpotType} />
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Price ₹/hour" type="number" min="1" value={form.price} onChange={set("price")} data-testid={TID.addSpotPrice} />
        </div>
      </div>

      <Field label="Vehicle types" value={form.vehicle} onChange={set("vehicle")} placeholder="Sedan/SUV" data-testid={TID.addSpotVehicle} />
      <Field label="Availability" value={form.available} onChange={set("available")} placeholder="Daily, 8 AM – 8 PM" data-testid={TID.addSpotAvailable} />

      <SpotPhotoPicker
        token={token}
        value={form.photo}
        onChange={(photo) => setForm(f => ({ ...f, photo }))}
      />

      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.g700, display: "block", marginBottom: 6 }}>
        Location — tap the map to place your spot
      </span>
      <div style={{ height: 190, borderRadius: 12, overflow: "hidden", border: `1px solid ${COLORS.g300}`, marginBottom: 6 }}>
        <MapContainer center={[coords.lat, coords.lng]} zoom={14} style={{ width: "100%", height: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
          <LocationPicker value={coords} onChange={setCoords} />
        </MapContainer>
      </div>
      <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>
        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
      </div>
    </Sheet>
  );
};

// ─── OWNER DASHBOARD ────────────────────────────────────
const OWNER_TAB_TEST_IDS = {
  dashboard: TID.ownerTabDashboard,
  listings: TID.ownerTabListings,
  earnings: TID.ownerTabEarnings,
};

const OwnerDashboard = ({ user, token, onLogout }) => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [spots, setSpots] = useState([]);
  const [spotsErr, setSpotsErr] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // Switching to Listings or Earnings is a navigation, so Back must
  // return to the dashboard rather than leaving the app. Without this the
  // owner console had no working Back at all.
  useBackGuard(activeTab !== "dashboard", () => setActiveTab("dashboard"));

  const [earnings, setEarnings] = useState(null);
  const [bookings, setBookings] = useState([]);

  const loadSpots = useCallback(() => {
    let cancelled = false;
    api.getSpots()
      .then(d => { if (!cancelled) { setSpots(d.spots); setSpotsErr(""); } })
      .catch(e => { if (!cancelled) setSpotsErr(e.message); });
    // Real revenue and real bookings against this owner's spots, replacing
    // the hard-coded figures that used to sit in the header.
    api.getOwnerEarnings(token)
      .then(d => { if (!cancelled) setEarnings(d); })
      .catch(() => {});
    api.getBookings(token)
      .then(d => { if (!cancelled) setBookings(d.bookings); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  useEffect(loadSpots, [loadSpots]);

  // Ownership is matched on created_by rather than the display name, so a
  // rename can't detach an owner from their listings.
  const myListings = spots.filter(s => s.created_by === user.id);

  const removeListing = async (spot) => {
    if (!window.confirm(`Delete “${spot.name}”? This cannot be undone.`)) return;
    try {
      await api.deleteSpot(token, spot.id);
      setSpots(prev => prev.filter(s => s.id !== spot.id));
    } catch (e) {
      setSpotsErr(e.message);
    }
  };

  return (
    <div className="ps-screen-min-h" data-testid={TID.ownerDashboard} style={{ background: COLORS.g50, fontFamily: fontB }}>
      <div style={{ background: COLORS.navy, padding: "24px 20px 20px", color: "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Good morning,</div>
            <div style={{ fontFamily: fontD, fontSize: 22, fontWeight: 700 }}>{user.name}</div>
          </div>
          <button onClick={onLogout} aria-label="Sign out" title="Sign out" data-testid={TID.signOut} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10, padding: 10, cursor: "pointer" }}>
            <Icon name="logout" size={20} color="white" />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            [earnings ? `₹${earnings.revenue.toLocaleString("en-IN")}` : "—", "Revenue"],
            [earnings ? String(earnings.bookings) : "—", "Bookings"],
            [String(myListings.length), "Listings"],
          ].map(([v, l], i) => (
            <div key={i} data-testid={TID.ownerStat} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 10px", textAlign: "center" }}>
              <div style={{ fontFamily: fontD, fontSize: 22, fontWeight: 700, color: COLORS.mint }}>{v}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {["dashboard", "listings", "earnings"].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} data-testid={OWNER_TAB_TEST_IDS[t]} style={{
              padding: "8px 16px", borderRadius: 99, border: "none", fontFamily: fontB, fontSize: 13, fontWeight: 600,
              background: activeTab === t ? COLORS.mint : "rgba(255,255,255,0.08)",
              color: activeTab === t ? COLORS.navy : "rgba(255,255,255,0.6)", cursor: "pointer", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {activeTab === "dashboard" && (
          <>
            <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy, marginBottom: 12 }}>
              Bookings on your spots {bookings.length > 0 && `(${bookings.length})`}
            </div>
            {/* Real bookings made against this owner's listings. */}
            {bookings.map(b => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, border: `1px solid ${COLORS.g200}`, marginBottom: 10, background: COLORS.white }}>
                {/* blue, not teal: white initials on teal is only 2.6:1. */}
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: b.status === "cancelled" ? COLORS.g600 : COLORS.blue, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
                  {b.user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy }}>{b.user.name}</span>
                    <Badge color={b.status === "active" ? "blue" : b.status === "cancelled" ? "red" : "gray"}>{b.status}</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{b.spot.name} · {b.date} · {b.hours}h</div>
                </div>
                <div style={{ fontFamily: fontD, fontWeight: 700, color: b.status === "cancelled" ? COLORS.textTertiary : COLORS.textSuccess, fontSize: 15 }}>
                  {b.status === "cancelled" ? `₹${b.total}` : `+₹${b.total}`}
                </div>
              </div>
            ))}
            {bookings.length === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: COLORS.textTertiary, fontSize: 14 }}>
                No bookings on your listings yet.
              </div>
            )}

            <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy, margin: "24px 0 12px" }}>Earnings overview</div>
            <div style={{ background: COLORS.white, borderRadius: 14, border: `1px solid ${COLORS.g200}`, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary }}>Total, all time</div>
                  <div style={{ fontFamily: fontD, fontSize: 28, fontWeight: 700, color: COLORS.navy }}>
                    ₹{earnings ? earnings.revenue.toLocaleString("en-IN") : "—"}
                  </div>
                </div>
                <Badge color="green">{earnings ? `${earnings.bookings} bookings` : "—"}</Badge>
              </div>
              <div style={{ fontSize: 11, color: COLORS.textTertiary, marginBottom: 10 }}>
                Daily shape below is illustrative; the total above is real.
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                {[35, 45, 30, 60, 55, 70, 40, 65, 50, 75, 80, 45, 55, 60, 70, 50, 65, 80, 55, 40, 70, 85, 60, 45, 50, 75, 55, 65, 80, 70].map((h, i) => (
                  <div key={i} style={{ flex: 1, height: `${h}%`, background: i < 7 ? COLORS.mint : COLORS.g200, borderRadius: 2, minWidth: 0 }} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: COLORS.textTertiary }}>
                <span>1 Sep</span><span>15 Sep</span><span>30 Sep</span>
              </div>
            </div>
          </>
        )}

        {activeTab === "listings" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy }}>
                Your listings ({myListings.length})
              </div>
              <Btn size="sm" testId={TID.addSpotOpen} onClick={() => setAddOpen(true)}><Icon name="plus" size={16} /> Add spot</Btn>
            </div>
            {spotsErr && (
              <div style={{ background: "#FFEBEE", color: COLORS.textError, padding: "12px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12 }}>
                {spotsErr}
              </div>
            )}
            {myListings.map(s => (
              <div key={s.id} data-testid={TID.ownerListingRow} {...record(RECORD_ATTR.spot, s.id)} style={{ display: "flex", gap: 12, padding: 16, borderRadius: 14, border: `1px solid ${COLORS.g200}`, background: COLORS.white, marginBottom: 12 }}>
                <img src={s.photo} alt={`${s.type} parking at ${s.name}`} loading="lazy" style={{ width: 80, height: 64, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: COLORS.g100 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.navy }}>{s.name}</span>
                    {s.verified ? <Badge color="green">Verified</Badge> : <Badge color="orange">Pending review</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{s.type} · {s.vehicle} · ₹{s.price}/hr</div>
                  <div style={{ fontSize: 12, color: COLORS.textWarning, marginTop: 4 }}>
                    {s.reviews > 0 ? `★ ${s.rating} (${s.reviews} reviews)` : "No reviews yet"}
                  </div>
                </div>
                <button
                  onClick={() => removeListing(s)}
                  aria-label={`Delete ${s.name}`}
                  style={{ background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start", padding: 4 }}
                >
                  <Icon name="x" size={16} color={COLORS.textTertiary} />
                </button>
              </div>
            ))}
            {!spotsErr && myListings.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: COLORS.textTertiary, fontSize: 14 }}>
                No listings yet. Tap “Add spot” to create one.
              </div>
            )}
          </>
        )}

        {activeTab === "earnings" && (
          <>
            <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy, marginBottom: 16 }}>Payout history</div>
            {[
              { date: "1 Sep 2026", amount: "₹8,200", status: "Paid" },
              { date: "15 Aug 2026", amount: "₹11,450", status: "Paid" },
              { date: "1 Aug 2026", amount: "₹9,800", status: "Paid" },
              { date: "15 Jul 2026", amount: "₹7,600", status: "Paid" },
            ].map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, borderRadius: 12, border: `1px solid ${COLORS.g200}`, background: COLORS.white, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy }}>{p.amount}</div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{p.date}</div>
                </div>
                <Badge color="green">✓ {p.status}</Badge>
              </div>
            ))}
          </>
        )}
      </div>

      {addOpen && (
        <AddSpotSheet
          token={token}
          onClose={() => setAddOpen(false)}
          onCreated={(spot) => {
            setAddOpen(false);
            setActiveTab("listings");
            // Trust the returned row rather than refetching, so the new
            // listing is visible even if the reload is slow.
            setSpots(prev => [...prev, spot]);
          }}
        />
      )}
    </div>
  );
};

// ─── DRIVER HOME ────────────────────────────────────────
// Tab id → test id. Kept beside the tab list rather than inline in the
// map callback so the two can't fall out of step.
const TAB_TEST_IDS = {
  home: TID.tabHome,
  search: TID.tabSearch,
  bookings: TID.tabBookings,
  saved: TID.tabSaved,
  profile: TID.tabProfile,
};

const DriverHome = ({ user, token, onLogout, onSession }) => {
  const [screen, setScreen] = useState("home");
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [tab, setTab] = useState("home");
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [booking, setBooking] = useState(null);
  const [bookingState, setBookingState] = useState({ busy: false, error: "" });

  const { location: gpsLocation, status: geoStatus, request: requestLocation } = useGeolocation();
  const [picking, setPicking] = useState(false);
  const [spots, setSpots] = useState([]);
  const [spotsErr, setSpotsErr] = useState("");
  const [loadingSpots, setLoadingSpots] = useState(true);
  // "nearby" limits to the pref radius around you; "all" drops the radius
  // so distant spots stay reachable.
  const [scope, setScope] = useState("nearby");

  const [prefs, setPrefs] = useState(prefsLib.load);
  const [favourites, setFavourites] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [bookingsErr, setBookingsErr] = useState("");
  const [sheet, setSheet] = useState(null); // filter | profile | vehicles | cards | settings | safety
  const [advanced, setAdvanced] = useState({ maxPrice: 0, verifiedOnly: false, sort: "distance" });

  const savePrefs = (next) => setPrefs(prefsLib.save(next));

  // A pinned location wins over the browser's, which on desktop is an
  // IP/Wi-Fi estimate and can be in the wrong city entirely.
  const location = prefs.manualLocation ?? gpsLocation;
  const locationSource = prefs.manualLocation ? "manual" : gpsLocation ? "gps" : "none";

  const setManualLocation = (coords) => {
    savePrefs({ ...prefs, manualLocation: coords });
    setPicking(false);
  };

  // Favourites and bookings both live server-side; load once per session.
  const loadFavourites = useCallback(() => {
    api.getFavourites(token)
      .then(d => setFavourites(d.favourites))
      .catch(() => setFavourites([]));
  }, [token]);

  const loadBookings = useCallback(() => {
    api.getBookings(token)
      .then(d => { setBookings(d.bookings); setBookingsErr(""); })
      .catch(e => setBookingsErr(e.message));
  }, [token]);

  useEffect(() => { loadFavourites(); loadBookings(); }, [loadFavourites, loadBookings]);

  const isFavourite = (spot) => favourites.includes(spot.id);

  const toggleFavourite = async (spot) => {
    const adding = !isFavourite(spot);
    // Optimistic: the heart should respond instantly, and it's reverted
    // below if the request fails.
    setFavourites(prev => adding ? [...prev, spot.id] : prev.filter(id => id !== spot.id));
    try {
      const d = adding
        ? await api.addFavourite(token, spot.id)
        : await api.removeFavourite(token, spot.id);
      setFavourites(d.favourites);
    } catch {
      setFavourites(prev => adding ? prev.filter(id => id !== spot.id) : [...prev, spot.id]);
    }
  };

  // "Book now" opens a review step; only the confirm there writes anything.
  const [pendingBooking, setPendingBooking] = useState(null);

  const reviewBooking = (spot, hours) => {
    setBookingState({ busy: false, error: "" });
    setPendingBooking({ spot, hours });
  };

  const confirmBooking = async () => {
    if (!pendingBooking) return;
    const { spot, hours } = pendingBooking;
    setBookingState({ busy: true, error: "" });
    try {
      const { booking: made } = await api.createBooking(token, { spotId: spot.id, hours });
      setPendingBooking(null);
      setBooking(made);
      setScreen("confirm");
      setBookingState({ busy: false, error: "" });
      loadBookings();
    } catch (e) {
      setBookingState({ busy: false, error: e.message });
    }
  };

  const cancelBooking = async (b) => {
    if (!window.confirm(`Cancel booking ${b.ref} at ${b.spot.name}?`)) return;
    try {
      const d = await api.cancelBooking(token, b.id);
      setBookings(prev => prev.map(x => x.id === d.booking.id ? d.booking : x));
    } catch (e) {
      setBookingsErr(e.message);
    }
  };

  const extendBooking = async (b) => {
    try {
      const d = await api.extendBooking(token, b.id, 1);
      setBookings(prev => prev.map(x => x.id === d.booking.id ? d.booking : x));
      setBookingsErr("");
    } catch (e) {
      setBookingsErr(e.message);
    }
  };

  // Bumped by the "Try again" button to re-run the fetch below.
  const [spotsReloadKey, setSpotsReloadKey] = useState(0);
  const reloadSpots = () => setSpotsReloadKey(k => k + 1);

  // Refetch whenever the origin or the radius changes, so distances are
  // always computed server-side against the current position.
  useEffect(() => {
    // Wait for the geolocation attempt to settle, otherwise we'd fetch
    // once against the fallback centre and again against the real one.
    if (geoStatus === "pending") return;

    let cancelled = false;
    setLoadingSpots(true);
    api.getSpots({
      lat: location?.lat,
      lng: location?.lng,
      radius: location && scope === "nearby" ? prefs.radiusM : undefined,
    })
      .then(d => { if (!cancelled) { setSpots(d.spots); setSpotsErr(""); } })
      .catch(e => { if (!cancelled) setSpotsErr(e.message); })
      .finally(() => { if (!cancelled) setLoadingSpots(false); });

    return () => { cancelled = true; };
  }, [location, geoStatus, scope, prefs.radiusM, spotsReloadKey]);

  const center = location ?? FALLBACK_CENTER;

  // The search box doubles as a place lookup, so the typed text narrows the
  // list only while it still matches something. Typing a neighbourhood name
  // that no listing mentions would otherwise blank the list out from under
  // the dropdown.
  const q = searchText.trim().toLowerCase();
  const textMatchesAnySpot = q.length > 0 && spots.some(
    s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)
  );

  const filtered = spots
    .filter(s => {
      const matchSearch = !textMatchesAnySpot ||
        s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q);
      const matchType = filterType === "all" || s.type.toLowerCase() === filterType.toLowerCase();
      const matchPrice = !advanced.maxPrice || s.price <= advanced.maxPrice;
      const matchVerified = !advanced.verifiedOnly && prefs.showUnverified ? true : s.verified;
      return matchSearch && matchType && matchPrice && matchVerified;
    })
    .sort((a, b) => {
      if (advanced.sort === "price") return a.price - b.price;
      if (advanced.sort === "rating") return b.rating - a.rating;
      // Distance is null when location is unavailable; keep server order.
      if (a.distance == null || b.distance == null) return 0;
      return a.distance - b.distance;
    });

  const openSpot = (s) => { setSelectedSpot(s); setScreen("detail"); };

  // Back from a secondary tab returns to Home instead of leaving the app.
  // Declared before the early returns below so the hook order stays stable;
  // when a detail screen is also open its own guard sits on top of this one,
  // so Back walks detail → tab → home.
  useBackGuard(tab !== "home", () => { setTab("home"); setScreen("home"); });

  // Pin-picking is a mode, and Back should leave it. This guard matters
  // more than it looks: picking is usually entered from Settings, which
  // sets tab back to "home" — so the tab guard above is inactive and,
  // without this, Back left the app entirely mid-pick.
  useBackGuard(picking, () => setPicking(false));

  if (screen === "detail" && selectedSpot) {
    return (
      <>
        <DetailScreen
          spot={selectedSpot}
          units={prefs.units}
          defaultHours={prefs.defaultHours}
          isFavourite={isFavourite(selectedSpot)}
          onToggleFavourite={toggleFavourite}
          booking={bookingState}
          onBack={() => { setBookingState({ busy: false, error: "" }); setScreen("home"); }}
          onBook={reviewBooking}
        />
        {pendingBooking && (
          <ConfirmBookingSheet
            spot={pendingBooking.spot}
            hours={pendingBooking.hours}
            units={prefs.units}
            busy={bookingState.busy}
            error={bookingState.error}
            onCancel={() => { setPendingBooking(null); setBookingState({ busy: false, error: "" }); }}
            onConfirm={confirmBooking}
          />
        )}
      </>
    );
  }
  if (screen === "confirm" && booking) {
    return <ConfirmScreen booking={booking} onDone={() => { setScreen("home"); setBooking(null); setTab("bookings"); }} />;
  }

  const tabs = [
    { id: "home", label: "Home", icon: "home" },
    { id: "search", label: "Search", icon: "search" },
    { id: "bookings", label: "Bookings", icon: "calendar" },
    { id: "saved", label: "Saved", icon: "heart" },
    { id: "profile", label: "Profile", icon: "user" },
  ];

  return (
    <div className="ps-screen-h" data-testid={TID.driverHome} style={{ display: "flex", flexDirection: "column", background: COLORS.white, fontFamily: fontB }}>
      {(tab === "home" || tab === "search") && (
        <>
          <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
            {/* `isolation: isolate` traps Leaflet's internal z-indexes (up to
                800 for its controls) inside this subtree, so the sheet and
                tab bar below only need small values to sit on top. */}
            <div className="ps-map-pane" style={{ position: "relative", isolation: "isolate", zIndex: 0 }}>
              <MapView
                spots={filtered}
                center={center}
                deviceLocation={gpsLocation}
                searchCentre={location}
                isPinned={locationSource === "manual"}
                radiusM={scope === "nearby" ? prefs.radiusM : 0}
                units={prefs.units}
                selectedSpot={selectedSpot}
                onSelectSpot={setSelectedSpot}
                onOpenSpot={openSpot}
                onRequestLocation={requestLocation}
                picking={picking}
                onPickLocation={setManualLocation}
              />
              {/* ps-map-chrome caps the width on desktop — a single search
                  input stretched across 1920px looks broken. */}
              <div className="ps-map-chrome" style={{ position: "absolute", top: 16, left: 16, right: 16, display: "flex", gap: 10, zIndex: Z.mapChrome }}>
                <SearchBox
                  value={searchText}
                  onChange={setSearchText}
                  spots={spots}
                  units={prefs.units}
                  onPickSpot={(s) => { setSearchText(""); openSpot(s); }}
                  onPickPlace={(p) => {
                    // Searching a place moves the search centre there and
                    // re-queries, so the list becomes "parking near <place>".
                    setSearchText("");
                    setManualLocation({ lat: p.lat, lng: p.lng, label: p.name });
                    setScope("nearby");
                  }}
                />
                <button
                  onClick={() => setSheet("filter")}
                  aria-label="Filters and sorting"
                  data-testid={TID.filterButton}
                  style={{ position: "relative", width: 48, height: 48, borderRadius: 14, background: COLORS.white, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <Icon name="filter" size={18} color={COLORS.g600} />
                  {(advanced.maxPrice > 0 || advanced.verifiedOnly || advanced.sort !== "distance") && (
                    <span style={{ position: "absolute", top: 9, right: 9, width: 8, height: 8, borderRadius: "50%", background: COLORS.mint, border: `1.5px solid ${COLORS.white}` }} />
                  )}
                </button>
              </div>
            </div>
            <div className="ps-spot-sheet" data-testid={TID.spotList} style={{ flex: 1, overflow: "auto", background: COLORS.white, borderRadius: "24px 24px 0 0", marginTop: -24, position: "relative", zIndex: Z.sheet, padding: "20px 16px 88px" }}>
              <div className="ps-sheet-handle" style={{ width: 40, height: 4, background: COLORS.g300, borderRadius: 4, margin: "0 auto 16px" }} />

              {/* Wraps on narrow screens: the title plus three chips don't
                  fit on one line at 320px. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: fontD, fontSize: 18, fontWeight: 600, color: COLORS.navy, whiteSpace: "nowrap" }}>
                  {location && scope === "nearby" ? "Nearby spots" : "All spots"}
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["all", "Covered", "Open"].map(f => (
                    <button key={f} onClick={() => setFilterType(f)} style={{
                      padding: "10px 14px", minHeight: 40, borderRadius: 99, border: "none", fontSize: 12, fontWeight: 600, fontFamily: fontB,
                      background: filterType === f ? COLORS.navy : COLORS.g100, color: filterType === f ? COLORS.white : COLORS.g600, cursor: "pointer",
                    }}>{f === "all" ? "All" : f}</button>
                  ))}
                </div>
              </div>

              {/* Location panel. States exactly where "you" is and where it
                  came from, because a browser fix on desktop is an IP/Wi-Fi
                  estimate that can be in the wrong city. */}
              <LocationPanel
                location={location}
                source={locationSource}
                geoStatus={geoStatus}
                scope={scope}
                radiusM={prefs.radiusM}
                picking={picking}
                onToggleScope={() => setScope(scope === "nearby" ? "all" : "nearby")}
                onRetryGps={requestLocation}
                onStartPicking={() => setPicking(true)}
                onCancelPicking={() => setPicking(false)}
                onClearManual={() => { savePrefs({ ...prefs, manualLocation: null }); requestLocation(); }}
              />

              {/* An error with no way out is a dead end — the user would
                  have to reload the page by hand. */}
              {spotsErr && (
                <div data-testid={TID.spotsError} style={{ background: "#FFEBEE", borderRadius: 10, padding: "14px", marginBottom: 12 }}>
                  <div style={{ color: COLORS.textError, fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                    {spotsErr}
                  </div>
                  <Btn size="sm" variant="outline" testId={TID.spotsRetry} onClick={reloadSpots}>Try again</Btn>
                </div>
              )}
              {loadingSpots && spots.length === 0 && !spotsErr && (
                <div style={{ textAlign: "center", padding: 40, color: COLORS.textTertiary, fontSize: 14 }}>Loading parking spots…</div>
              )}
              {filtered.map(s => (
                <SpotCard
                  key={s.id}
                  spot={s}
                  units={prefs.units}
                  isFavourite={isFavourite(s)}
                  onToggleFavourite={toggleFavourite}
                  onClick={() => openSpot(s)}
                />
              ))}
              {!loadingSpots && !spotsErr && filtered.length === 0 && (
                spots.length === 0 && scope === "nearby" ? (
                  // Nothing in range. The demo listings are Chennai-only, so
                  // say that outright instead of leaving a dead end.
                  <div data-testid={TID.spotsEmpty} style={{ textAlign: "center", padding: "28px 8px", color: COLORS.textSecondary, fontSize: 13, lineHeight: 1.6 }}>
                    <div style={{ fontSize: 30, marginBottom: 8 }}>🅿️</div>
                    <div style={{ fontWeight: 600, color: COLORS.navy, fontSize: 15, marginBottom: 4 }}>
                      No spots within {prefs.radiusM / 1000} km of you
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      All demo listings are in central Chennai, so there'll be
                      nothing nearby if you're elsewhere.
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                      <Btn size="sm" onClick={() => setManualLocation(FALLBACK_CENTER)}>
                        Jump to Chennai
                      </Btn>
                      <Btn size="sm" variant="outline" onClick={() => setScope("all")}>
                        Show all spots
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <div data-testid={TID.spotsEmpty} style={{ textAlign: "center", padding: 40, color: COLORS.textTertiary, fontSize: 14 }}>
                    No spots match your filters.
                  </div>
                )
              )}
            </div>
          </div>
        </>
      )}

      {tab === "bookings" && (
        <div className="ps-content-column" data-testid={TID.bookingsScreen} style={{ flex: 1, overflow: "auto", padding: "20px 16px 80px" }}>
          <ScreenHeader
            title="Your bookings"
            onBack={() => setTab("home")}
            action={<Btn size="sm" variant="ghost" onClick={loadBookings}>Refresh</Btn>}
          />
          {bookingsErr && <Notice>{bookingsErr}</Notice>}
          {bookings.map(b => (
            <div key={b.id} data-testid={TID.bookingCard} {...record(RECORD_ATTR.booking, b.id)} style={{ display: "flex", gap: 12, padding: 16, borderRadius: 14, border: `1px solid ${COLORS.g200}`, marginBottom: 12, background: COLORS.white }}>
              <img src={b.spot.photo} alt={b.spot.name} loading="lazy" style={{ width: 68, height: 56, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: COLORS.g100 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.navy }}>{b.spot.name}</div>
                  <span data-testid={TID.bookingStatus}>
                    <Badge color={b.status === "active" ? "blue" : b.status === "cancelled" ? "red" : "gray"}>
                      {b.status[0].toUpperCase() + b.status.slice(1)}
                    </Badge>
                  </span>
                </div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary, margin: "4px 0" }}>{b.date} · {b.time}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: COLORS.textSecondary }}>#{b.ref} · {b.hours}h</span>
                  <span style={{ fontFamily: fontD, fontWeight: 700, color: COLORS.navy }}>₹{b.total}</span>
                </div>
                {/* Only an active booking can be changed; the server enforces
                    this too, so a stale screen can't cancel a past booking. */}
                {b.status === "active" && (
                  // Wraps rather than overflowing: three buttons don't fit
                  // on one line at 320px.
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <Btn size="sm" variant="ghost" testId={TID.bookingExtend} onClick={() => extendBooking(b)}>+1 hour</Btn>
                    <Btn size="sm" variant="outline" testId={TID.bookingCancel} onClick={() => cancelBooking(b)}>Cancel</Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => window.open(`https://www.openstreetmap.org/directions?to=${b.spot.lat},${b.spot.lng}`, "_blank", "noopener")}
                    >
                      Directions
                    </Btn>
                  </div>
                )}
              </div>
            </div>
          ))}
          {/* The old copy told you to "find a spot on the map" without
              giving you a way to get there. */}
          {!bookingsErr && bookings.length === 0 && (
            <div data-testid={TID.bookingsEmpty} style={{ textAlign: "center", padding: "36px 16px" }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🅿️</div>
              <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy, marginBottom: 6 }}>
                No bookings yet
              </div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.55, marginBottom: 18 }}>
                Once you book a parking spot it'll appear here, with directions
                and the option to extend or cancel.
              </div>
              <Btn onClick={() => { setTab("home"); setScreen("home"); }}>
                <Icon name="search" size={16} color={COLORS.navy} /> Find parking
              </Btn>
            </div>
          )}
        </div>
      )}

      {tab === "saved" && (
        <div className="ps-content-column" data-testid={TID.savedScreen} style={{ flex: 1, overflow: "auto", padding: "20px 16px 80px" }}>
          <ScreenHeader title="Saved spots" onBack={() => setTab("home")} />
          {/* Real favourites from the DB, not "every verified spot". */}
          {spots.filter(s => favourites.includes(s.id)).map(s => (
            <SpotCard
              key={s.id}
              spot={s}
              units={prefs.units}
              isFavourite
              onToggleFavourite={toggleFavourite}
              onClick={() => openSpot(s)}
            />
          ))}
          {spots.filter(s => favourites.includes(s.id)).length === 0 && (
            <div data-testid={TID.savedEmpty} style={{ textAlign: "center", padding: "36px 16px" }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🤍</div>
              <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy, marginBottom: 6 }}>
                Nothing saved yet
              </div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.55, marginBottom: 18 }}>
                Tap the heart on any spot to keep it here for quick access.
              </div>
              <Btn onClick={() => { setTab("home"); setScreen("home"); }}>
                <Icon name="search" size={16} color={COLORS.navy} /> Browse spots
              </Btn>
            </div>
          )}
        </div>
      )}

      {tab === "profile" && (
        <div className="ps-content-column" data-testid={TID.profileScreen} style={{ flex: 1, overflow: "auto", padding: "20px 16px 80px" }}>
          <ScreenHeader title="Profile" onBack={() => setTab("home")} />
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: `linear-gradient(135deg, ${COLORS.teal}, ${COLORS.mint})`, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: COLORS.white, fontFamily: fontD }}>{user.name.charAt(0)}</div>
            <div data-testid={TID.profileName} style={{ fontFamily: fontD, fontSize: 20, fontWeight: 700, color: COLORS.navy }}>{user.name}</div>
            <div data-testid={TID.profileEmail} style={{ fontSize: 13, color: COLORS.textSecondary }}>{user.email}</div>
            <Badge color="blue" style={{ marginTop: 8 }}>Driver</Badge>
          </div>
          <Row testId={TID.profileRow} icon="user" label="Edit profile" value={user.phone || "No phone number"} onClick={() => setSheet("profile")} />
          <Row testId={TID.profileRow} icon="car" label="My vehicles" onClick={() => setSheet("vehicles")} />
          <Row testId={TID.profileRow} icon="cash" label="Payment methods" onClick={() => setSheet("cards")} />
          <Row testId={TID.profileRow} icon="settings" label="Settings" value={`${prefs.radiusM / 1000} km radius · ${prefs.units}`} onClick={() => setSheet("settings")} />
          <Row testId={TID.profileRow} icon="shield" label="Safety and privacy" onClick={() => setSheet("safety")} />
          <div style={{ marginTop: 24 }}><Btn variant="danger" full testId={TID.signOut} onClick={onLogout}><Icon name="logout" size={18} color="white" /> Sign out</Btn></div>
        </div>
      )}

      {/* ps-tabbar adds the home-indicator inset to the bottom padding. */}
      {/* justify-content lives in CSS, not here: an inline value would
          beat the desktop media query that groups the items centrally. */}
      <div className="ps-tabbar" data-testid={TID.tabBar} style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", paddingTop: 8, borderTop: `1px solid ${COLORS.g200}`, background: COLORS.white, zIndex: Z.tabBar, boxShadow: "0 -2px 12px rgba(13,27,42,0.06)" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === "home") setScreen("home"); }} data-testid={TAB_TEST_IDS[t.id]} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2, border: "none", background: "transparent", cursor: "pointer", padding: "4px 12px",
            // The tab bar sits on white, where mint is 1.9:1 — the active
            // label was the least readable text in the app.
            color: tab === t.id ? COLORS.textBrand : COLORS.textTertiary, fontFamily: fontB, fontSize: 10, fontWeight: tab === t.id ? 600 : 400,
          }}>
            <Icon name={t.icon} size={22} color={tab === t.id ? COLORS.textBrand : COLORS.textTertiary} />
            {t.label}
          </button>
        ))}
      </div>

      {sheet === "filter" && (
        <FilterSheet
          value={advanced}
          onChange={setAdvanced}
          onClose={() => setSheet(null)}
          maxPriceSeen={spots.reduce((m, s) => Math.max(m, s.price), 60)}
        />
      )}
      {sheet === "profile" && (
        <EditProfileSheet
          user={user}
          token={token}
          onClose={() => setSheet(null)}
          onSaved={onSession}
        />
      )}
      {sheet === "vehicles" && <VehiclesSheet token={token} onClose={() => setSheet(null)} />}
      {sheet === "cards" && <CardsSheet token={token} onClose={() => setSheet(null)} />}
      {sheet === "settings" && (
        <SettingsSheet
          prefs={prefs}
          onSave={savePrefs}
          onClose={() => setSheet(null)}
          onPickLocation={() => { setTab("home"); setPicking(true); }}
        />
      )}
      {sheet === "safety" && (
        <SafetySheet user={user} onClose={() => setSheet(null)} onSignOut={onLogout} />
      )}
    </div>
  );
};

// ─── ADMIN DASHBOARD ────────────────────────────────────
const ROLE_BADGE = { admin: "purple", owner: "blue", driver: "green" };

const AdminDashboard = ({ user, token, onLogout }) => {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [spots, setSpots] = useState([]);
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // Same as the owner console: Spots is a navigation away from Users, so
  // Back belongs to the app, not the browser's session history.
  useBackGuard(tab !== "users", () => setTab("users"));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, s, sp] = await Promise.all([
        api.listUsers(token),
        api.getStats(token),
        api.getSpots(),
      ]);
      setUsers(u.users);
      setStats(s);
      setSpots(sp.spots);
      setErr("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const changeRole = async (target, role) => {
    setErr("");
    try {
      const d = await api.setUserRole(token, target.id, role);
      setUsers(prev => prev.map(u => u.id === d.user.id ? d.user : u));
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const removeUser = async (target) => {
    if (!window.confirm(`Delete ${target.name} (${target.email})? Their bookings go too.`)) return;
    setErr("");
    try {
      await api.deleteUser(token, target.id);
      setUsers(prev => prev.filter(u => u.id !== target.id));
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const toggleVerified = async (spot) => {
    setErr("");
    try {
      const d = await api.setSpotVerified(token, spot.id, !spot.verified);
      setSpots(prev => prev.map(s => s.id === d.spot.id ? d.spot : s));
    } catch (e) {
      setErr(e.message);
    }
  };

  const removeSpot = async (spot) => {
    if (!window.confirm(`Delete “${spot.name}”? This cannot be undone.`)) return;
    setErr("");
    try {
      await api.deleteSpot(token, spot.id);
      setSpots(prev => prev.filter(s => s.id !== spot.id));
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const cards = [
    ["Users", stats?.total], ["Spots", stats?.spots],
    ["Bookings", stats?.bookings], ["Owners", stats?.owners],
  ];

  return (
    <div className="ps-screen-min-h" data-testid={TID.adminDashboard} style={{ background: COLORS.g50, fontFamily: fontB }}>
      <div style={{ background: COLORS.navy, padding: "24px 20px 20px", color: "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>🛡️ Admin console</div>
            <div style={{ fontFamily: fontD, fontSize: 22, fontWeight: 700 }}>{user.name}</div>
          </div>
          <button onClick={onLogout} title="Sign out" aria-label="Sign out" data-testid={TID.signOut} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10, padding: 10, cursor: "pointer" }}>
            <Icon name="logout" size={20} color="white" />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {cards.map(([label, value]) => (
            <div key={label} data-testid={TID.adminStat} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 10px", textAlign: "center" }}>
              <div style={{ fontFamily: fontD, fontSize: 22, fontWeight: 700, color: COLORS.mint }}>{value ?? "—"}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {["users", "spots"].map(t => (
            <button key={t} onClick={() => setTab(t)} data-testid={t === "users" ? TID.adminTabUsers : TID.adminTabSpots} style={{
              padding: "8px 16px", borderRadius: 99, border: "none", fontFamily: fontB, fontSize: 13, fontWeight: 600,
              background: tab === t ? COLORS.mint : "rgba(255,255,255,0.08)",
              color: tab === t ? COLORS.navy : "rgba(255,255,255,0.6)", cursor: "pointer", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {err && (
          <div style={{ background: "#FFEBEE", color: COLORS.textError, padding: "12px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
            {err} <button onClick={load} style={{ marginLeft: 8, background: "none", border: "none", color: COLORS.textError, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {tab === "users" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy }}>
                Registered users {!loading && `(${users.length})`}
              </div>
              <Btn size="sm" variant="ghost" onClick={load}>{loading ? "Loading…" : "Refresh"}</Btn>
            </div>
            {loading && users.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: COLORS.textTertiary, fontSize: 14 }}>Loading users…</div>
            )}
            {users.map(u => (
              <div key={u.id} data-testid={TID.adminUserRow} {...record(RECORD_ATTR.user, u.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, border: `1px solid ${COLORS.g200}`, marginBottom: 10, background: COLORS.white }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.teal})`, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, fontFamily: fontD, flexShrink: 0 }}>
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy }}>{u.name}</span>
                    <Badge color={ROLE_BADGE[u.role] || "gray"}>{u.role}</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                  <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 2 }}>#{u.id} · joined {u.created_at?.split(" ")[0]}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                    <select
                      value={u.role}
                      onChange={e => changeRole(u, e.target.value)}
                      aria-label={`Role for ${u.name}`}
                      data-testid={TID.adminUserRole}
                      style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${COLORS.g300}`, fontFamily: fontB, fontSize: 12, cursor: "pointer", background: COLORS.white }}
                    >
                      {["driver", "owner", "admin"].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button
                      onClick={() => removeUser(u)}
                      aria-label={`Delete user ${u.name}`}
                      data-testid={TID.adminUserDelete}
                      style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${COLORS.red}`, background: COLORS.white, color: COLORS.textError, fontFamily: fontB, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      Delete
                    </button>
                    {u.id === user.id && (
                      <span style={{ fontSize: 11, color: COLORS.textTertiary }}>you</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4, lineHeight: 1.5 }}>
              The server blocks changing your own role, deleting your own
              account, and removing the last admin — so you can't lock
              yourself out.
            </div>
          </>
        )}

        {tab === "spots" && (
          <>
            <div style={{ fontFamily: fontD, fontSize: 16, fontWeight: 600, color: COLORS.navy, marginBottom: 12 }}>
              All listings {!loading && `(${spots.length})`}
            </div>
            {loading && spots.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: COLORS.textTertiary, fontSize: 14 }}>Loading listings…</div>
            )}
            {spots.map(s => (
              <div key={s.id} data-testid={TID.adminSpotRow} {...record(RECORD_ATTR.spot, s.id)} style={{ display: "flex", gap: 12, padding: 14, borderRadius: 12, border: `1px solid ${COLORS.g200}`, marginBottom: 10, background: COLORS.white }}>
                <img src={s.photo} alt={`${s.type} parking at ${s.name}`} loading="lazy" style={{ width: 62, height: 50, borderRadius: 9, objectFit: "cover", flexShrink: 0, background: COLORS.g100 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy }}>{s.name}</span>
                    {s.verified ? <Badge color="green">Verified</Badge> : <Badge color="orange">Pending</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{s.owner} · {s.type} · ₹{s.price}/hr</div>
                  <div style={{ fontSize: 11, color: COLORS.textTertiary }}>
                    {s.lat.toFixed(4)}, {s.lng.toFixed(4)} · {s.reviews > 0 ? `★ ${s.rating}` : "no reviews"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    {/* Labels name the spot so screen readers (and tests)
                        can tell one row's buttons from another's. */}
                    <button
                      onClick={() => toggleVerified(s)}
                      aria-label={`${s.verified ? "Unverify" : "Verify"} ${s.name}`}
                      data-testid={TID.adminSpotVerify}
                      style={{
                        padding: "5px 10px", borderRadius: 7, border: `1px solid ${s.verified ? COLORS.g300 : COLORS.textSuccess}`,
                        background: COLORS.white, color: s.verified ? COLORS.g700 : COLORS.textSuccess,
                        fontFamily: fontB, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      {s.verified ? "Unverify" : "Verify"}
                    </button>
                    <button
                      onClick={() => removeSpot(s)}
                      aria-label={`Delete ${s.name}`}
                      data-testid={TID.adminSpotDelete}
                      style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${COLORS.red}`, background: COLORS.white, color: COLORS.textError, fontFamily: fontB, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

// ─── MAIN APP ───────────────────────────────────────────
export default function App() {
  // Restored from localStorage on first render, so a page reload doesn't
  // kick you out and there's no signed-out flash before it loads.
  const [session, setSession] = useState(api.loadSession);
  const [authNotice, setAuthNotice] = useState("");

  const handleLogin = (s) => { api.saveSession(s); setSession(s); };
  const handleLogout = () => { api.clearSession(); setSession(null); };

  // Any 401 from anywhere in the app means the session is gone. Sign out
  // and say why, instead of leaving the user on a screen whose data will
  // never load.
  useEffect(() => {
    api.onUnauthorized((message) => {
      api.clearSession();
      setSession(null);
      setAuthNotice(message);
    });
    return () => api.onUnauthorized(null);
  }, []);

  // The OAuth callback sends the browser back here with either a one-time
  // handoff code or an error message. Both are stripped from the URL so a
  // reload can't replay them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("oauth");
    const error = params.get("oauth_error");
    if (!code && !error) return;

    const clean = () => window.history.replaceState({}, "", window.location.pathname);

    if (error) {
      setAuthNotice(error);
      clean();
      return;
    }

    let cancelled = false;
    api.exchangeOAuthCode(code)
      .then(s => { if (!cancelled) handleLogin(s); })
      .catch(e => { if (!cancelled) setAuthNotice(e.message); })
      .finally(clean);

    return () => { cancelled = true; };
  }, []);

  if (!session) return <AuthScreen onLogin={handleLogin} notice={authNotice} onDismissNotice={() => setAuthNotice("")} />;

  const { user, token } = session;
  if (user.role === "admin") return <AdminDashboard user={user} token={token} onLogout={handleLogout} />;
  if (user.role === "owner") return <OwnerDashboard user={user} token={token} onLogout={handleLogout} />;
  return (
    <DriverHome
      user={user}
      token={token}
      onLogout={handleLogout}
      // Editing the email reissues the token, so the session must be replaced.
      onSession={handleLogin}
    />
  );
}
