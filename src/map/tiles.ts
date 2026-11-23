/**
 * The one place the map's tile source is chosen. Esri World Street Map needs
 * no API key and labels more places than OpenStreetMap's own tiles. Note the
 * path order is {z}/{y}/{x}, not {z}/{x}/{y}. If this host changes, the
 * `img-src` Content-Security-Policy in server/index.js must change with it.
 */
export const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";

export const TILE_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, OpenStreetMap contributors";

export const TILE_MAX_ZOOM = 19;
