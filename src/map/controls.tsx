import { useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";

import { Icon } from "../components";
import { COLORS } from "../theme";
import type { LatLng, Spot } from "@shared/models";

import s from "./controls.module.css";

export interface MapControllerProps {
  center: LatLng;
  selectedSpot?: Spot | null;
}

/**
 * Leaflet needs an imperative nudge when the centre changes or the
 * container is first laid out inside a flex parent.
 */
export const MapController = ({ center, selectedSpot }: MapControllerProps) => {
  const map = useMap();

  useEffect(() => {
    /* The map lives in a flex child whose height is a percentage, so its
       box can settle after first paint and change again on rotate or
       keyboard show. A one-shot timeout missed those cases and left bands
       of unrendered grey; watch the container instead. */
    map.invalidateSize();

    const el = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);

    const onOrientation = (): void => {
      setTimeout(() => map.invalidateSize(), 150);
    };
    window.addEventListener("orientationchange", onOrientation);

    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [map]);

  useEffect(() => {
    if (center) map.setView([center.lat, center.lng], map.getZoom());
  }, [map, center]);

  useEffect(() => {
    if (selectedSpot) map.panTo([selectedSpot.lat, selectedSpot.lng]);
  }, [map, selectedSpot]);

  return null;
};

export interface RecenterControlProps {
  userLocation?: LatLng | null;
  onRequest: () => void;
}

/**
 * "Locate me": pans back to the user, or re-requests permission if we
 * never got a fix. Rendered inside the map so it sits with the other map
 * chrome.
 */
export const RecenterControl = ({ userLocation, onRequest }: RecenterControlProps) => {
  const map = useMap();
  const label = userLocation ? "Centre on my location" : "Find my location";

  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        if (userLocation) map.setView([userLocation.lat, userLocation.lng], 15);
        else onRequest();
      }}
      className={s.recenter}
    >
      {/* A real colour, not a var(): Icon sets an SVG stroke attribute. */}
      <Icon name="nav" size={18} color={userLocation ? COLORS.blue : COLORS.textTertiary} />
    </button>
  );
};

export interface PickLocationProps {
  onPick: (position: LatLng) => void;
}

/** In picking mode a tap anywhere on the map sets the user's position. */
export const PickLocation = ({ onPick }: PickLocationProps) => {
  useMapEvents({
    click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
};
