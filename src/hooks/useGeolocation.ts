import { useCallback, useEffect, useState } from "react";

import type { GeoPosition } from "@shared/models";

export type GeoStatus = "pending" | "granted" | "denied" | "unsupported";

export interface UseGeolocation {
  location: GeoPosition | null;
  status: GeoStatus;
  /** Ask again — for the "locate me" button after a denial or timeout. */
  request: () => void;
}

/**
 * Asks the browser for a position once.
 *
 * Denial or failure is NOT an error state for the app: `location` stays
 * null and callers fall back to the Chennai centre, so the map always
 * renders something.
 */
export const useGeolocation = (): UseGeolocation => {
  const [location, setLocation] = useState<GeoPosition | null>(null);
  const [status, setStatus] = useState<GeoStatus>("pending");

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        /* `accuracy` is the radius of confidence in metres. A value in
           the tens of kilometres means an IP/Wi-Fi lookup, not GPS —
           which is why the dot can land in the wrong city. */
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { timeout: 8000, maximumAge: 60_000, enableHighAccuracy: true },
    );
  }, []);

  useEffect(() => {
    request();
  }, [request]);

  return { location, status, request };
};
