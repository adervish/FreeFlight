import { Hono } from "hono";
import type { Bindings } from "../types";

const CURRENT_CYCLE = "2603";
const FAA_PDF_BASE = `https://aeronav.faa.gov/d-tpp/${CURRENT_CYCLE}`;

// Chart code display order and labels
const CHART_ORDER: Record<string, { order: number; label: string }> = {
  APD: { order: 1, label: "Airport Diagram" },
  HOT: { order: 2, label: "Hot Spots" },
  IAP: { order: 3, label: "Approaches" },
  DP: { order: 4, label: "Departures" },
  STAR: { order: 5, label: "Arrivals" },
  ODP: { order: 6, label: "Obstacle DPs" },
  MIN: { order: 7, label: "Minimums" },
  LAH: { order: 8, label: "LAHSO" },
  DAU: { order: 9, label: "DAU" },
};

const app = new Hono<{ Bindings: Bindings }>();

// GET /api/plates/info/:ident — full airport info (frequencies + runways)
app.get("/info/:ident", async (c) => {
  const ident = c.req.param("ident").toUpperCase();

  const [freqResult, rwyResult] = await Promise.all([
    c.env.DB.prepare(
      "SELECT service_type, freq_tx, freq_rx, remarks FROM faa_frequencies WHERE airport_ident = ? ORDER BY service_type, freq_tx"
    ).bind(ident).all(),
    c.env.DB.prepare(
      "SELECT designator, length_ft, width_ft, surface, lighting FROM faa_runways WHERE airport_ident = ? ORDER BY length_ft DESC"
    ).bind(ident).all(),
  ]);

  return c.json({
    frequencies: freqResult.results,
    runways: rwyResult.results,
  });
});

// GET /api/plates/:ident — list plates for an airport
app.get("/:ident", async (c) => {
  const ident = c.req.param("ident").toUpperCase();

  // Try both FAA ident and ICAO ident
  const result = await c.env.DB.prepare(
    `SELECT chart_code, chart_name, pdf_name FROM faa_plates
     WHERE airport_ident = ? OR icao_ident = ?
     ORDER BY chart_code, chart_name`
  ).bind(ident, ident).all();

  if (result.results.length === 0) {
    return c.json({ error: "No plates found" }, 404);
  }

  // Group by chart type
  const groups: Record<string, { label: string; order: number; plates: { name: string; pdf: string }[] }> = {};
  for (const row of result.results as { chart_code: string; chart_name: string; pdf_name: string }[]) {
    const code = row.chart_code;
    if (!groups[code]) {
      const meta = CHART_ORDER[code] || { order: 99, label: code };
      groups[code] = { label: meta.label, order: meta.order, plates: [] };
    }
    groups[code].plates.push({ name: row.chart_name, pdf: row.pdf_name });
  }

  // Sort groups by order
  const sorted = Object.entries(groups)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([code, g]) => ({ code, label: g.label, plates: g.plates }));

  return c.json(sorted);
});

// GET /api/plates/:ident/:pdf — serve from R2, fallback to FAA proxy
app.get("/:ident/:pdf", async (c) => {
  const pdf = c.req.param("pdf");
  if (!pdf.toUpperCase().endsWith(".PDF")) {
    return c.json({ error: "Invalid PDF name" }, 400);
  }

  const r2Key = `${CURRENT_CYCLE}/${pdf}`;

  // Try R2 first (if available)
  const r2Obj = c.env.PLATES_BUCKET ? await c.env.PLATES_BUCKET.get(r2Key) : null;
  if (r2Obj) {
    return new Response(r2Obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "public, max-age=604800",
        "Content-Disposition": `inline; filename="${pdf}"`,
      },
    });
  }

  // Fallback: proxy from FAA and cache to R2
  const faaUrl = `${FAA_PDF_BASE}/${pdf}`;
  const res = await fetch(faaUrl);
  if (!res.ok) {
    return c.json({ error: "PDF not found" }, 404);
  }

  const body = await res.arrayBuffer();

  // Cache to R2 in background (if available)
  if (c.env.PLATES_BUCKET) {
    c.executionCtx.waitUntil(
      c.env.PLATES_BUCKET.put(r2Key, body, {
        httpMetadata: { contentType: "application/pdf" },
      })
    );
  }

  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=604800",
      "Content-Disposition": `inline; filename="${pdf}"`,
    },
  });
});

export default app;
