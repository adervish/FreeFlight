import { Hono } from "hono";
import type { Bindings } from "../types";
import { LAYER_CONFIG, zoomToH3Res } from "../lib/feature-config";
import { polygonToCells } from "h3-js";

const app = new Hono<{ Bindings: Bindings }>();

// Compute H3 cells that cover a bounding box
function boundsToH3Cells(
  latMin: number, lngMin: number, latMax: number, lngMax: number, res: number
): string[] {
  // polygonToCells takes a GeoJSON-style polygon (lng, lat order)
  const polygon = [
    [lngMin, latMin],
    [lngMax, latMin],
    [lngMax, latMax],
    [lngMin, latMax],
    [lngMin, latMin],
  ];
  try {
    return polygonToCells(polygon, res, true);
  } catch {
    return [];
  }
}

// GET /api/features?layers=airports,navaids&zoom=10&bounds=latMin,lngMin,latMax,lngMax
app.get("/", async (c) => {
  const layerNames = (c.req.query("layers") || "").split(",").filter(Boolean);
  const zoom = parseInt(c.req.query("zoom") || "10");
  const boundsStr = c.req.query("bounds") || "";

  if (layerNames.length === 0 || !boundsStr) {
    return c.json({ error: "layers and bounds parameters required" }, 400);
  }

  const bounds = boundsStr.split(",").map(Number);
  if (bounds.length !== 4 || bounds.some(isNaN)) {
    return c.json({ error: "bounds must be latMin,lngMin,latMax,lngMax" }, 400);
  }
  const [latMin, lngMin, latMax, lngMax] = bounds;

  const h3Res = zoomToH3Res(zoom);
  const h3Cells = h3Res !== null
    ? boundsToH3Cells(latMin, lngMin, latMax, lngMax, h3Res)
    : [];

  // If too many cells (zoomed out too far), fall back to bbox query
  const useH3 = h3Res !== null && h3Cells.length > 0 && h3Cells.length <= 200;

  const results: Record<string, any[]> = {};

  for (const name of layerNames) {
    const config = LAYER_CONFIG[name];
    if (!config) continue;

    // Skip layers that shouldn't appear at this zoom
    if (h3Res !== null && h3Res < config.minH3Res) {
      results[name] = [];
      continue;
    }

    // Determine tier threshold
    const tierThreshold = h3Res !== null
      ? (config.tierAtRes[h3Res] ?? 3)
      : 3;

    let query: string;
    let params: any[] = [];

    if (useH3) {
      const h3Col = `h3_res${h3Res}`;
      const placeholders = h3Cells.map(() => "?").join(",");
      query = `SELECT ${config.selectColumns} FROM ${config.table}
        WHERE ${h3Col} IN (${placeholders})
        AND tier <= ?
        LIMIT 5000`;
      params = [...h3Cells, tierThreshold];
    } else {
      // Bounding box fallback
      query = `SELECT ${config.selectColumns} FROM ${config.table}
        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
        AND tier <= ?
        LIMIT 5000`;
      params = [latMin, latMax, lngMin, lngMax, tierThreshold];
    }

    try {
      const stmt = c.env.DB.prepare(query);
      const result = await stmt.bind(...params).all();
      results[name] = result.results;
    } catch (e: any) {
      console.error(`Feature query error for ${name}:`, e.message);
      results[name] = [];
    }
  }

  return c.json(results);
});

// GET /api/features/config — returns layer config for frontend
app.get("/config", (c) => {
  const config: Record<string, { label: string; style: string; minH3Res: number }> = {};
  for (const [name, cfg] of Object.entries(LAYER_CONFIG)) {
    config[name] = { label: cfg.label, style: cfg.style, minH3Res: cfg.minH3Res };
  }
  return c.json(config);
});

export default app;
