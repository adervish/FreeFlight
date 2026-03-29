// Feature visibility configuration
// Controls what shows at each zoom level based on H3 resolution and tier
//
// H3 res 3 (~60km hexes) → map zoom 5-8  (regional view)
// H3 res 4 (~22km hexes) → map zoom 9-11 (metro view)
// H3 res 5 (~8km hexes)  → map zoom 12+  (close view)
// At zoom 13+ → show everything in bounding box, no H3 filtering
//
// Tier 1 = most important (always show when layer is active)
// Tier 2 = medium importance (show at mid zoom)
// Tier 3 = least important (show only when zoomed in)

export interface LayerConfig {
  table: string;
  label: string;
  // At which H3 resolution does this layer start appearing?
  minH3Res: 3 | 4 | 5;
  // What tier threshold at each resolution? (show features with tier <= threshold)
  tierAtRes: { [res: number]: number };
  // Columns to return
  selectColumns: string;
  // How to convert a row to GeoJSON properties
  geojsonType: "point" | "label";
  // Icon/style hint for frontend
  style: string;
}

export const LAYER_CONFIG: Record<string, LayerConfig> = {
  airports: {
    table: "faa_airports",
    label: "Airports",
    minH3Res: 3,
    tierAtRes: { 3: 1, 4: 2, 5: 3 },
    selectColumns: "ident, name, icao_id, latitude, longitude, elevation, type_code, mil_code, iap_exists, private_use, tier",
    geojsonType: "point",
    style: "airport",
  },
  navaids: {
    table: "faa_navaids",
    label: "Navaids",
    minH3Res: 4,
    tierAtRes: { 4: 1, 5: 2 },
    selectColumns: "ident, name, class, latitude, longitude, tier",
    geojsonType: "point",
    style: "navaid",
  },
  waypoints: {
    table: "faa_designated_points",
    label: "Waypoints",
    minH3Res: 5,
    tierAtRes: { 5: 3 },
    selectColumns: "ident, latitude, longitude, type_code, tier",
    geojsonType: "label",
    style: "waypoint",
  },
  obstacles: {
    table: "faa_obstacles",
    label: "Obstacles",
    minH3Res: 4,
    tierAtRes: { 4: 1, 5: 3 },
    selectColumns: "oas_number, latitude, longitude, type_code, agl, amsl, lighting, tier",
    geojsonType: "point",
    style: "obstacle",
  },
  ils: {
    table: "faa_ils",
    label: "ILS",
    minH3Res: 4,
    tierAtRes: { 4: 1, 5: 2 },
    selectColumns: "ident, airport_id, runway, system_type, latitude, longitude, category, frequency, tier",
    geojsonType: "point",
    style: "ils",
  },
};

// Map Google Maps zoom level to H3 resolution
export function zoomToH3Res(zoom: number): number | null {
  if (zoom >= 13) return null; // show everything, use bbox
  if (zoom >= 12) return 5;
  if (zoom >= 9) return 4;
  if (zoom >= 5) return 3;
  return 3;
}
