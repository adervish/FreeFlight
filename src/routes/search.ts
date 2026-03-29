import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// GET /api/search?q=lax
app.get("/", async (c) => {
  const q = (c.req.query("q") || "").trim();
  if (q.length < 2) {
    return c.json([]);
  }

  const like = `%${q}%`;
  const result = await c.env.DB.prepare(
    `SELECT ident, name, icao_id, city, state, latitude, longitude, type_code
     FROM faa_airports
     WHERE ident LIKE ?1 OR icao_id LIKE ?1 OR name LIKE ?1 OR city LIKE ?1
     ORDER BY
       CASE WHEN ident = ?2 OR icao_id = ?2 THEN 0
            WHEN ident LIKE ?3 OR icao_id LIKE ?3 THEN 1
            WHEN name LIKE ?3 THEN 2
            ELSE 3 END,
       tier ASC,
       name ASC
     LIMIT 10`
  ).bind(like, q.toUpperCase(), q.toUpperCase() + "%").all();

  // Attach frequencies for each result
  for (const apt of result.results as Record<string, any>[]) {
    const freqResult = await c.env.DB.prepare(
      "SELECT service_type, freq_tx FROM faa_frequencies WHERE airport_ident = ? ORDER BY service_type"
    ).bind(apt.ident).all();
    apt.frequencies = freqResult.results;
  }

  return c.json(result.results);
});

export default app;
