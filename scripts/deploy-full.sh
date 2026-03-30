#!/bin/bash
# Full deploy: schema + worker + all FAA data
# Usage: ./scripts/deploy-full.sh [--skip-data]
set -e

SKIP_DATA=false
if [ "$1" = "--skip-data" ]; then
  SKIP_DATA=true
fi

echo "=== FreeFlight Full Deploy ==="
echo ""

# 1. Deploy Worker + static assets
echo "--- Deploying Worker ---"
npx wrangler deploy
echo ""

if [ "$SKIP_DATA" = true ]; then
  echo "Skipping data load (--skip-data)"
  exit 0
fi

# 2. Init schema
echo "--- Initializing schema ---"
npx wrangler d1 execute freeflight-db --remote --file=./schema-faa.sql || true
echo ""

# 3. Load FAA data (sequentially to avoid D1 write conflicts)
echo "--- Loading airports ---"
npx tsx scripts/download-faa-data.ts --remote --skip-flatfile --only airports || true
echo ""

echo "--- Loading navaids ---"
npx tsx scripts/download-faa-data.ts --remote --skip-flatfile --only navaids || true
echo ""

echo "--- Loading ILS ---"
npx tsx scripts/download-faa-data.ts --remote --skip-flatfile --only ils || true
echo ""

echo "--- Loading ATIS/AWOS frequencies ---"
npx tsx scripts/download-frequencies.ts --remote || true
echo ""

echo "--- Loading UNICOM/CTAF frequencies ---"
if [ -f /tmp/all-airport-data.xlsx ]; then
  npx tsx scripts/load-airport-frequencies.ts --remote --file /tmp/all-airport-data.xlsx || true
else
  echo "  Skipping (download https://adip.faa.gov/publishedAirports/all-airport-data.xlsx to /tmp first)"
fi
echo ""

echo "--- Loading runways ---"
npx tsx scripts/download-runways.ts --remote || true
echo ""

echo "--- Loading CIFP waypoints ---"
if [ -f /tmp/cifp/FAACIFP18 ]; then
  npx tsx scripts/parse-cifp-waypoints.ts --remote --cifp /tmp/cifp/FAACIFP18 || true
else
  echo "  Skipping (download CIFP: curl -sL -o /tmp/cifp.zip https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260319.zip && cd /tmp && unzip cifp.zip -d cifp)"
fi
echo ""

echo "--- Loading plates index ---"
if [ -f data/plates/d-tpp_Metafile_2603.xml ]; then
  npx tsx scripts/load-plates-index.ts --remote || true
else
  echo "  Skipping (run 'npx tsx scripts/download-plates.ts' first to get metafile)"
fi
echo ""

echo "=== Deploy complete ==="
