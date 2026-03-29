#!/usr/bin/env tsx
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CYCLE = process.argv.find((_, i, a) => a[i - 1] === "--cycle") || "2603";
const BUCKET = "betaplanes-plates";
const PLATES_DIR = path.resolve(__dirname, `../data/plates/${CYCLE}`);
const CONCURRENT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--concurrent") || "5");

async function main() {
  console.log(`Uploading plates to R2 — Cycle ${CYCLE}`);
  console.log(`Source: ${PLATES_DIR}`);
  console.log(`Bucket: ${BUCKET}\n`);

  const files = fs.readdirSync(PLATES_DIR).filter((f) => f.toUpperCase().endsWith(".PDF"));
  console.log(`${files.length} PDFs to upload\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i += CONCURRENT) {
    const batch = files.slice(i, i + CONCURRENT);
    const promises = batch.map(async (file) => {
      const localPath = path.join(PLATES_DIR, file);
      const r2Key = `${CYCLE}/${file}`;
      try {
        execSync(
          `npx wrangler r2 object put "${BUCKET}/${r2Key}" --file="${localPath}" --content-type="application/pdf"`,
          { stdio: "pipe", timeout: 30000 }
        );
        uploaded++;
      } catch {
        failed++;
      }
    });
    await Promise.all(promises);

    if ((i + CONCURRENT) % 500 === 0 || i + CONCURRENT >= files.length) {
      console.log(`  ${uploaded + skipped}/${files.length} uploaded (${failed} failed)`);
    }
  }

  console.log(`\n━━━ Summary ━━━`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Failed: ${failed}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
