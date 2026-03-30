import type { Bindings } from "../types";

const TFR_WFS_URL =
  "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json";

const TFR_TEXT_URL = "https://tfr.faa.gov/tfrapi/getWebText?notamId=";

interface TfrFeature {
  type: "Feature";
  id: string;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  properties: {
    GID: number;
    CNS_LOCATION_ID: string;
    NOTAM_KEY: string;
    TITLE: string;
    LAST_MODIFICATION_DATETIME: string;
    STATE: string;
    LEGAL: string;
  };
}

interface TfrFeatureCollection {
  type: "FeatureCollection";
  features: TfrFeature[];
  totalFeatures: number;
}

interface TfrTextResponse {
  notam_id: string;
  text: string;
}

interface NotamDetail {
  dateEffective: string | null;
  dateExpiry: string | null;
  text: string;
}

// Parse "March 28, 2026 at 1911 UTC" into ISO 8601
function parseFaaDate(str: string): string | null {
  // Match: "Month DD, YYYY at HHMM UTC"
  const match = str.match(
    /(\w+ \d{1,2}, \d{4}) at (\d{4}) UTC/
  );
  if (!match) return null;
  const dateStr = match[1];
  const time = match[2];
  const hh = time.slice(0, 2);
  const mm = time.slice(2, 4);
  const d = new Date(`${dateStr} ${hh}:${mm}:00 UTC`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseNotamHtml(html: string): { dateEffective: string | null; dateExpiry: string | null } {
  let dateEffective: string | null = null;
  let dateExpiry: string | null = null;

  // Extract "Beginning Date and Time" value
  const beginMatch = html.match(
    /Beginning Date and Time\s*(?:<[^>]*>)*\s*(?:<[^>]*>)*\s*(?:<[^>]*>)*\s*(?:<[^>]*>)*\s*([^<]+)/i
  );
  if (beginMatch) {
    dateEffective = parseFaaDate(beginMatch[1].trim());
  }

  // Extract "Ending Date and Time" value
  const endMatch = html.match(
    /Ending Date and Time\s*(?:<[^>]*>)*\s*(?:<[^>]*>)*\s*(?:<[^>]*>)*\s*(?:<[^>]*>)*\s*([^<]+)/i
  );
  if (endMatch) {
    dateExpiry = parseFaaDate(endMatch[1].trim());
  }

  return { dateEffective, dateExpiry };
}

// Strip HTML tags for plain text storage
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:TR|TD|DT|DL|DD|P|DIV)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#xBA;/g, "°")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchNotamDetail(notamId: string): Promise<NotamDetail> {
  // notamId from NOTAM_KEY is like "6/5418-1-FDC-F", we need just "6/5418"
  const shortId = notamId.split("-")[0];
  const resp = await fetch(`${TFR_TEXT_URL}${encodeURIComponent(shortId)}`);
  if (!resp.ok) {
    return { dateEffective: null, dateExpiry: null, text: "" };
  }
  const data = (await resp.json()) as TfrTextResponse[];
  if (!data.length) {
    return { dateEffective: null, dateExpiry: null, text: "" };
  }
  const html = data[0].text;
  const { dateEffective, dateExpiry } = parseNotamHtml(html);
  return { dateEffective, dateExpiry, text: stripHtml(html) };
}

export async function syncTfrs(env: Bindings): Promise<{ added: number; removed: number; total: number }> {
  const response = await fetch(TFR_WFS_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`FAA GeoServer responded ${response.status}`);
  }

  const data = (await response.json()) as TfrFeatureCollection;
  const features = data.features;

  // Fetch text/dates for each unique NOTAM (batch in groups of 10 to avoid hammering)
  const uniqueNotams = [...new Set(features.map((f) => f.properties.NOTAM_KEY))];
  const notamDetails = new Map<string, NotamDetail>();

  for (let i = 0; i < uniqueNotams.length; i += 10) {
    const batch = uniqueNotams.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async (key) => {
        const detail = await fetchNotamDetail(key);
        return [key, detail] as const;
      })
    );
    for (const [key, detail] of results) {
      notamDetails.set(key, detail);
    }
  }

  // Replace all TFRs in a single transaction
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];

  stmts.push(env.DB.prepare("DELETE FROM faa_tfrs"));

  for (const f of features) {
    const p = f.properties;
    const detail = notamDetails.get(p.NOTAM_KEY);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO faa_tfrs (gid, notam_key, title, state, legal, cns_location_id, geometry_json, date_effective, date_expiry, notam_text, last_modified, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        p.GID,
        p.NOTAM_KEY,
        p.TITLE,
        p.STATE,
        p.LEGAL,
        p.CNS_LOCATION_ID,
        JSON.stringify(f.geometry),
        detail?.dateEffective ?? null,
        detail?.dateExpiry ?? null,
        detail?.text ?? null,
        p.LAST_MODIFICATION_DATETIME,
        now
      )
    );
  }

  stmts.push(
    env.DB.prepare(
      `INSERT INTO faa_load_log (source, record_count, status) VALUES ('tfr-sync', ?, 'ok')`
    ).bind(features.length)
  );

  await env.DB.batch(stmts);

  return { added: features.length, removed: 0, total: features.length };
}
