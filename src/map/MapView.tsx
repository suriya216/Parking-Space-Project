import { Circle, MapContainer, Marker, Popup, TileLayer, ZoomControl } from "react-leaflet";

import { COLORS } from "../theme";
import { cx } from "../styles/cx";
import { formatDistance } from "../prefs";
import type { LatLng, Spot, Units } from "@shared/models";

import { MapController, PickLocation, RecenterControl } from "./controls";
import { pinIcon, priceIcon, userIcon } from "./markers";
import s from "./MapView.module.css";

export interface MapViewProps {
  spots: Spot[];
  center: LatLng;
  /** The browser's own fix, when it gave us one. */
  deviceLocation?: LatLng | null;
  /** Whatever the search is actually centred on — device fix or pin. */
  searchCentre?: LatLng | null;
  isPinned?: boolean;
  radiusM: number;
  units?: Units;
  selectedSpot?: Spot | null;
  onSelectSpot: (spot: Spot) => void;
  onOpenSpot: (spot: Spot) => void;
  onRequestLocation: () => void;
  picking?: boolean;
  onPickLocation: (position: LatLng) => void;
}

/** The Leaflet + OpenStreetMap map, with price markers and the radius. */
export const MapView = ({
  spots,
  center,
  deviceLocation,
  searchCentre,
  isPinned,
  radiusM,
  units = "km",
  selectedSpot,
  onSelectSpot,
  onOpenSpot,
  onRequestLocation,
  picking,
  onPickLocation,
}: MapViewProps) => (
  <MapContainer
    center={[center.lat, center.lng]}
    zoom={14}
    zoomControl={false}
    className={cx(s.map, picking && s.picking)}
  >
    <TileLayer
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      maxZoom={19}
    />
    {/* Bottom-left keeps it clear of the recentre button and the filter
        button in the top-right corner. Hidden entirely on touch — see
        src/styles/leaflet.css. */}
    <ZoomControl position="bottomleft" />
    <MapController center={center} selectedSpot={selectedSpot} />
    {picking && <PickLocation onPick={onPickLocation} />}
    {!picking && (
      <RecenterControl
        userLocation={deviceLocation ?? searchCentre}
        onRequest={onRequestLocation}
      />
    )}

    {/* The device's own position, whenever the browser gives us one. Shown
        even while a pin is active, so the two are never confused. */}
    {deviceLocation && (
      <Marker
        position={[deviceLocation.lat, deviceLocation.lng]}
        icon={userIcon}
        title="Your device location"
      />
    )}

    {/* The radius is always drawn around whatever the search is actually
        centred on, and a pin marker appears when that isn't the device. */}
    {searchCentre && radiusM > 0 && (
      <Circle
        center={[searchCentre.lat, searchCentre.lng]}
        radius={radiusM}
        pathOptions={{
          color: COLORS.textLink,
          weight: 1,
          fillColor: COLORS.teal,
          fillOpacity: 0.07,
        }}
      />
    )}
    {isPinned && searchCentre && (
      <Marker
        position={[searchCentre.lat, searchCentre.lng]}
        icon={pinIcon}
        title="Pinned search location"
      />
    )}

    {/* `spot`, not `s` — `s` is the CSS module in this file. */}
    {spots.map((spot) => (
      <Marker
        key={spot.id}
        position={[spot.lat, spot.lng]}
        icon={priceIcon(spot, selectedSpot?.id === spot.id)}
        eventHandlers={{ click: () => onSelectSpot(spot) }}
      >
        <Popup>
          <div className={s.popup}>
            <img src={spot.photo} alt={spot.name} className={s.photo} />
            <div className={s.name}>{spot.name}</div>
            <div className={s.address}>{spot.address}</div>
            <div className={s.meta}>
              ★ {spot.rating || "new"} · {spot.type} ·{" "}
              {formatDistance(spot.distance, units)}
            </div>
            <button onClick={() => onOpenSpot(spot)} className={s.view}>
              View · ₹{spot.price}/hr
            </button>
          </div>
        </Popup>
      </Marker>
    ))}
  </MapContainer>
);
