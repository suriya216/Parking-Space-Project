import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";

import type { LatLng, RouteInfo } from "@shared/models";

import { getRoute } from "../api";
import { Btn, Notice, Sheet } from "../components";
import { useGeolocation } from "../hooks/useGeolocation";
import { COLORS } from "../theme";

import { pinIcon, userIcon } from "./markers";
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL } from "./tiles";
import s from "./RouteSheet.module.css";

export interface RouteSheetProps {
  /** Where the driver is going. */
  destination: LatLng;
  /** Shown in the header. */
  name: string;
  onClose: () => void;
}

/** Turn-by-turn is Google's job; this hands the same trip over to it. */
const googleMapsUrl = (to: LatLng): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`;

const formatDistance = (m: number): string =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

const formatDuration = (sec: number): string => {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
};

/** Frames the whole route, and re-measures once the sheet has slid into place. */
const FitRoute = ({ points }: { points: [number, number][] }) => {
  const map = useMap();
  useEffect(() => {
    const fit = (): void => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 17 });
    };
    fit();
    const t = setTimeout(fit, 350);
    return () => clearTimeout(t);
  }, [map, points]);
  return null;
};

interface Result {
  key: string;
  route: RouteInfo | null;
  error: string | null;
}

/**
 * The fastest drive from where the driver is to a booked spot, on a mini map
 * inside the app. Without a location fix it still shows the spot, says why
 * there is no route, and keeps the hand-off to Google Maps available.
 */
export const RouteSheet = ({ destination, name, onClose }: RouteSheetProps) => {
  const { location, status, request } = useGeolocation();
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  const key = location
    ? `${location.lat},${location.lng}>${destination.lat},${destination.lng}#${attempt}`
    : null;

  useEffect(() => {
    if (!location || !key) return;
    let live = true;
    getRoute(location, destination)
      .then((route) => live && setResult({ key, route, error: null }))
      .catch((e: Error) => live && setResult({ key, route: null, error: e.message }));
    return () => {
      live = false;
    };
    // `key` already encodes both endpoints and the retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A result for an older key is stale, which is the same as "still loading".
  const current = result && result.key === key ? result : null;
  const route = current?.route ?? null;
  const loading = Boolean(location) && !current;
  const points: [number, number][] = route
    ? route.path
    : location
      ? [[location.lat, location.lng], [destination.lat, destination.lng]]
      : [[destination.lat, destination.lng]];

  return (
    <Sheet
      title="Route to your spot"
      subtitle={name}
      onClose={onClose}
      footer={
        <div className={s.footer}>
          <Btn
            variant="secondary"
            full
            onClick={() => window.open(googleMapsUrl(destination), "_blank", "noopener")}
          >
            Navigate in Google Maps
          </Btn>
          <Btn full onClick={onClose}>Close</Btn>
        </div>
      }
    >
      <div className={s.map}>
        <MapContainer
          center={[destination.lat, destination.lng]}
          zoom={15}
          zoomControl={false}
          attributionControl={false}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={TILE_MAX_ZOOM} />
          {route && (
            <Polyline
              positions={route.path}
              pathOptions={{ color: COLORS.navy, weight: 6, opacity: 0.85 }}
            />
          )}
          {location && <Marker position={[location.lat, location.lng]} icon={userIcon} />}
          <Marker position={[destination.lat, destination.lng]} icon={pinIcon} />
          <FitRoute points={points} />
        </MapContainer>
      </div>

      <div className={s.summary} aria-live="polite">
        {loading && <span>Finding the fastest route…</span>}
        {route && (
          <>
            <strong>{formatDuration(route.duration)}</strong>
            <span>{formatDistance(route.distance)} · fastest route by road</span>
          </>
        )}
        {!location && status === "pending" && <span>Getting your location…</span>}
      </div>

      {!location && status !== "pending" && (
        <Notice tone="info">
          {status === "unsupported"
            ? "This device can't share its location, so the route can't be drawn."
            : "Allow location access to see the route from where you are."}
          {status !== "unsupported" && (
            <div className={s.retry}>
              <Btn size="sm" variant="outline" onClick={request}>Try again</Btn>
            </div>
          )}
        </Notice>
      )}
      {current?.error && (
        <Notice tone="info">
          {current.error}
          <div className={s.retry}>
            <Btn size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Btn>
          </div>
        </Notice>
      )}
      <div className={s.note}>
        Time is an estimate without live traffic. Use Google Maps for turn-by-turn voice guidance.
      </div>
    </Sheet>
  );
};
