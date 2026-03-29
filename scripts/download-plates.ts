#!/usr/bin/env tsx
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseString } from "xml2js";

// ─── Config ──────────────────────────────────────────────────

const CYCLE = process.argv.find((_, i, a) => a[i - 1] === "--cycle") || "2603";
const META_URL = `https://aeronav.faa.gov/d-tpp/${CYCLE}/xml_data/d-tpp_Metafile.xml`;
const PDF_BASE = `https://aeronav.faa.gov/d-tpp/${CYCLE}`;
const DATA_DIR = path.resolve(__dirname, "../data/plates");
const CYCLE_DIR = path.join(DATA_DIR, CYCLE);
const META_FILE = path.join(DATA_DIR, `d-tpp_Metafile_${CYCLE}.xml`);
const CONCURRENT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--concurrent") || "10");
const onlyAirport = process.argv.find((_, i, a) => a[i - 1] === "--airport") || null;
const onlyType = process.argv.find((_, i, a) => a[i - 1] === "--type") || null;
const DELAY_MS = 50;

// ─── Download helpers ────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<boolean> {
  if (fs.existsSync(dest)) return true; // already downloaded

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  [${res.status}] ${url}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    return true;
  } catch (e: any) {
    console.error(`  Error: ${url} — ${e.message}`);
    return false;
  }
}

async function downloadBatch(tasks: { url: string; dest: string }[], concurrent: number) {
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  const total = tasks.length;

  for (let i = 0; i < tasks.length; i += concurrent) {
    const batch = tasks.slice(i, i + concurrent);
    const results = await Promise.all(
      batch.map(async (t) => {
        if (fs.existsSync(t.dest)) {
          skipped++;
          return true;
        }
        return downloadFile(t.url, t.dest);
      })
    );

    for (const r of results) {
      if (r) completed++;
      else failed++;
    }

    if ((i + concurrent) % 500 === 0 || i + concurrent >= total) {
      console.log(`  ${completed + skipped}/${total} downloaded (${skipped} cached, ${failed} failed)`);
    }

    if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  return { completed, failed, skipped };
}

// ─── Parse metafile ──────────────────────────────────────────

interface PlateRecord {
  airport: string;
  icao: string;
  state: string;
  city: string;
  chartCode: string;
  chartName: string;
  pdfName: string;
}

async function parseMetafile(xmlPath: string): Promise<PlateRecord[]> {
  const xml = fs.readFileSync(xmlPath, "utf-8");
  const records: PlateRecord[] = [];

  // Simple regex parsing — xml2js may not be installed
  const stateRe = /<state_code\s+ID="([^"]*)"[^>]*>/g;
  const cityRe = /<city_name\s+ID="([^"]*)"[^>]*>/g;
  const airportRe = /<airport_name\s+[^>]*apt_ident="([^"]*)"[^>]*icao_ident="([^"]*)"[^>]*/g;
  const recordRe = /<record>[\s\S]*?<\/record>/g;
  const fieldRe = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`);

  // Parse state by state
  const stateBlocks = xml.split(/<state_code\s/);
  for (const stateBlock of stateBlocks.slice(1)) {
    const stateMatch = stateBlock.match(/ID="([^"]*)"/);
    const stateId = stateMatch ? stateMatch[1] : "";

    const cityBlocks = stateBlock.split(/<city_name\s/);
    for (const cityBlock of cityBlocks.slice(1)) {
      const cityMatch = cityBlock.match(/ID="([^"]*)"/);
      const cityId = cityMatch ? cityMatch[1] : "";

      const airportBlocks = cityBlock.split(/<airport_name\s/);
      for (const aptBlock of airportBlocks.slice(1)) {
        const aptMatch = aptBlock.match(/apt_ident="([^"]*)"/);
        const icaoMatch = aptBlock.match(/icao_ident="([^"]*)"/);
        const aptId = aptMatch ? aptMatch[1] : "";
        const icaoId = icaoMatch ? icaoMatch[1] : "";

        let match;
        const recRe = /<record>([\s\S]*?)<\/record>/g;
        while ((match = recRe.exec(aptBlock)) !== null) {
          const rec = match[1];
          const chartCode = rec.match(fieldRe("chart_code"))?.[1] || "";
          const chartName = rec.match(fieldRe("chart_name"))?.[1] || "";
          const pdfName = rec.match(fieldRe("pdf_name"))?.[1] || "";

          if (pdfName) {
            records.push({
              airport: aptId,
              icao: icaoId,
              state: stateId,
              city: cityId,
              chartCode,
              chartName,
              pdfName,
            });
          }
        }
      }
    }
  }

  return records;
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log(`FAA Approach Plates Downloader — Cycle ${CYCLE}`);
  console.log(`Output: ${CYCLE_DIR}`);
  console.log(`Concurrency: ${CONCURRENT}`);
  if (onlyAirport) console.log(`Airport filter: ${onlyAirport}`);
  if (onlyType) console.log(`Type filter: ${onlyType}`);
  console.log("");

  // Step 1: Download metafile
  fs.mkdirSync(CYCLE_DIR, { recursive: true });

  if (!fs.existsSync(META_FILE)) {
    console.log("Downloading metafile...");
    const ok = await downloadFile(META_URL, META_FILE);
    if (!ok) {
      console.error("Failed to download metafile");
      process.exit(1);
    }
    console.log(`  ✓ ${(fs.statSync(META_FILE).size / 1024 / 1024).toFixed(1)}MB\n`);
  } else {
    console.log("Metafile cached.\n");
  }

  // Step 2: Parse metafile
  console.log("Parsing metafile...");
  let records = await parseMetafile(META_FILE);
  console.log(`  ${records.length} total records\n`);

  // Step 3: Filter
  if (onlyAirport) {
    const apt = onlyAirport.toUpperCase();
    records = records.filter((r) => r.airport === apt || r.icao === apt);
    console.log(`  Filtered to ${records.length} records for ${apt}\n`);
  }

  if (onlyType) {
    const t = onlyType.toUpperCase();
    records = records.filter((r) => r.chartCode === t);
    console.log(`  Filtered to ${records.length} ${t} records\n`);
  }

  // Deduplicate by PDF name (some shared across airports like TAKEOFF MINIMUMS)
  const seen = new Set<string>();
  const uniqueRecords: PlateRecord[] = [];
  for (const r of records) {
    if (!seen.has(r.pdfName)) {
      seen.add(r.pdfName);
      uniqueRecords.push(r);
    }
  }
  console.log(`  ${uniqueRecords.length} unique PDFs to download\n`);

  // Step 4: Build download tasks
  const tasks = uniqueRecords.map((r) => ({
    url: `${PDF_BASE}/${r.pdfName}`,
    dest: path.join(CYCLE_DIR, r.pdfName),
  }));

  // Step 5: Download
  console.log("Downloading PDFs...");
  const result = await downloadBatch(tasks, CONCURRENT);
  console.log(`\n━━━ Summary ━━━`);
  console.log(`  Total: ${uniqueRecords.length}`);
  console.log(`  Downloaded: ${result.completed}`);
  console.log(`  Cached: ${result.skipped}`);
  console.log(`  Failed: ${result.failed}`);

  // Step 6: Write index
  const indexPath = path.join(CYCLE_DIR, "index.json");
  const index: Record<string, { icao: string; state: string; city: string; plates: { code: string; name: string; pdf: string }[] }> = {};
  for (const r of records) {
    if (!index[r.airport]) {
      index[r.airport] = { icao: r.icao, state: r.state, city: r.city, plates: [] };
    }
    index[r.airport].plates.push({ code: r.chartCode, name: r.chartName, pdf: r.pdfName });
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`\n  Index: ${Object.keys(index).length} airports → ${indexPath}`);

  // Size summary
  let totalSize = 0;
  for (const t of tasks) {
    try { totalSize += fs.statSync(t.dest).size; } catch {}
  }
  console.log(`  Total size: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
