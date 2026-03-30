import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import features from "./routes/features";
import plates from "./routes/plates";
import search from "./routes/search";
import tfrs from "./routes/tfrs";
import { syncTfrs } from "./cron/tfr-sync";

const app = new Hono<{ Bindings: Bindings }>();
app.use("*", cors());

app.get("/api/config", (c) => {
  return c.json({ mapsApiKey: c.env.GOOGLE_MAPS_API_KEY });
});

app.route("/api/features", features);
app.route("/api/plates", plates);
app.route("/api/search", search);
app.route("/api/tfrs", tfrs);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      syncTfrs(env).then((result) => {
        console.log(`TFR sync complete: ${result.total} TFRs`);
      }).catch((err) => {
        console.error("TFR sync failed:", err);
      })
    );
  },
};
