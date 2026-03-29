#!/usr/bin/env tsx
import * as http from "http";
import * as fs from "fs";
import * as path from "path";

const PORT = parseInt(process.env.PORT || "3000");
const PROD_API = "https://freeflight.bentboolean.com";
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  // Proxy API requests to production
  if (url.startsWith("/api/")) {
    try {
      const proxyUrl = PROD_API + url;
      const proxyRes = await fetch(proxyUrl, {
        method: req.method,
        headers: { "User-Agent": "BETAPlanes-Dev" },
      });
      res.writeHead(proxyRes.status, {
        "Content-Type": proxyRes.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      const body = Buffer.from(await proxyRes.arrayBuffer());
      res.end(body);
    } catch (e: any) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: "Proxy error: " + e.message }));
    }
    return;
  }

  // Serve static files
  let filePath = path.join(PUBLIC_DIR, url === "/" ? "index.html" : url);

  // SPA fallback: if file doesn't exist and looks like a tail number route, serve index.html
  if (!fs.existsSync(filePath) && url.match(/^\/N[A-Z0-9]+$/)) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  BETAPlanes UI Dev Server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  API proxy → ${PROD_API}`);
  console.log(`  Static files → ${PUBLIC_DIR}`);
  console.log(`\n  Edit files in public/ and refresh.\n`);
});
