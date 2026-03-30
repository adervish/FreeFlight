import { Hono } from "hono";
import type { Bindings } from "../types";
import { syncTfrs } from "../cron/tfr-sync";

const app = new Hono<{ Bindings: Bindings }>();

// GET /api/tfrs — returns all active TFRs as GeoJSON FeatureCollection
app.get("/", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT notam_key, title, state, legal, cns_location_id, geometry_json,
            date_effective, date_expiry, notam_text, last_modified
     FROM faa_tfrs`
  ).all();

  const features = result.results.map((row: any) => ({
    type: "Feature" as const,
    id: row.notam_key,
    geometry: JSON.parse(row.geometry_json),
    properties: {
      notam_key: row.notam_key,
      title: row.title,
      state: row.state,
      legal: row.legal,
      cns_location_id: row.cns_location_id,
      date_effective: row.date_effective,
      date_expiry: row.date_expiry,
      notam_text: row.notam_text,
      last_modified: row.last_modified,
    },
  }));

  return c.json({
    type: "FeatureCollection",
    features,
  });
});

// POST /api/tfrs/sync — manual trigger
app.post("/sync", async (c) => {
  const result = await syncTfrs(c.env);
  return c.json(result);
});

// GET /api/tfrs/log — last 24h of sync runs
app.get("/log", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT source, loaded_at, record_count, status
     FROM faa_load_log
     WHERE source = 'tfr-sync'
       AND loaded_at >= datetime('now', '-1 day')
     ORDER BY loaded_at DESC`
  ).all();

  return c.json(result.results);
});

export default app;
