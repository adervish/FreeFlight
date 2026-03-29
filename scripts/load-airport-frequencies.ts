#!/usr/bin/env tsx
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const isRemote = process.argv.includes("--remote");
const XLSX_PATH = process.argv.find((_, i, a) => a[i - 1] === "--file") || "/tmp/all-airport-data.xlsx";

function esc(val: any): string {
  if (val === null || val === undefined || val === "") return "NULL";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  return "'" + String(val).replace(/'/g, "''").replace(/[\x00-\x1f\\]/g, "") + "'";
}

async function main() {
  console.log("Loading airport frequencies from XLSX...");
  console.log(`File: ${XLSX_PATH}`);
  console.log(`Target: ${isRemote ? "REMOTE" : "LOCAL"}\n`);

  // Use python to extract the data since openpyxl is already installed
  const pyFile = path.resolve(__dirname, "extract-frequencies.py");
  const result = execSync(`python3 "${pyFile}" "${XLSX_PATH}"`, {
    maxBuffer: 100 * 1024 * 1024,
  }).toString();

  const raw = JSON.parse(result) as { a: string; t: string; f: string }[];
  const records = raw.map(r => ({ airport: r.a, type: r.t, freq: r.f }));
  console.log(`${records.length} frequency records extracted\n`);

  // Merge with existing frequencies (don't delete, add UNICOM/CTAF/TOWER that are missing)
  const flag = isRemote ? "--remote" : "--local";

  // Create table if needed
  execSync(`npx wrangler d1 execute freeflight-db ${flag} --command="CREATE TABLE IF NOT EXISTS faa_frequencies (id INTEGER PRIMARY KEY AUTOINCREMENT, airport_ident TEXT NOT NULL, service_type TEXT, freq_tx REAL, freq_rx REAL, remarks TEXT); CREATE INDEX IF NOT EXISTS idx_faa_freq_airport ON faa_frequencies(airport_ident);"`, { stdio: "pipe" });

  // Delete only UNICOM/CTAF/TOWER entries (keep ATIS/AWOS from previous load)
  if (isRemote) {
    execSync(`npx wrangler d1 execute freeflight-db --remote --command="DELETE FROM faa_frequencies WHERE service_type IN ('UNICOM','CTAF','TOWER')"`, { stdio: "pipe" });
  }

  const BATCH = 100;
  const lines: string[] = isRemote ? [] : ["DELETE FROM faa_frequencies WHERE service_type IN ('UNICOM','CTAF','TOWER');"];

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const values = batch.map((r) => {
      const freq = parseFloat(r.freq);
      return "(" + [r.airport, r.type, isNaN(freq) ? null : freq, isNaN(freq) ? null : freq, null].map(esc).join(",") + ")";
    }).join(",");
    lines.push(`INSERT INTO faa_frequencies (airport_ident, service_type, freq_tx, freq_rx, remarks) VALUES ${values};`);
  }

  if (isRemote) {
    for (let i = 0; i < lines.length; i++) {
      const tmpFile = `/tmp/freq-xlsx-${Date.now()}.sql`;
      fs.writeFileSync(tmpFile, lines[i]);
      try {
        execSync(`npx wrangler d1 execute freeflight-db --remote --file=${tmpFile}`, {
          stdio: "pipe", timeout: 30000, maxBuffer: 50 * 1024 * 1024,
        });
      } catch (e: any) {}
      fs.unlinkSync(tmpFile);
      if (i % 50 === 0 && i > 0) console.log(`  ${Math.min(i * BATCH, records.length)}/${records.length}...`);
      await new Promise(r => setTimeout(r, 200));
    }
  } else {
    const tmpFile = `/tmp/freq-xlsx-${Date.now()}.sql`;
    fs.writeFileSync(tmpFile, lines.join("\n"));
    try {
      execSync(`npx wrangler d1 execute freeflight-db --local --file=${tmpFile}`, {
        stdio: "pipe", timeout: 120000, maxBuffer: 50 * 1024 * 1024,
      });
    } catch (e: any) {
      const stdout = e.stdout?.toString() || "";
      if (!stdout.includes("rows_written")) throw e;
    }
    fs.unlinkSync(tmpFile);
  }

  console.log(`\n✓ Loaded ${records.length} UNICOM/CTAF/TOWER frequency records`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
