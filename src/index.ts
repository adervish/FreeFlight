import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import features from "./routes/features";
import plates from "./routes/plates";
import search from "./routes/search";

const app = new Hono<{ Bindings: Bindings }>();
app.use("*", cors());

app.get("/api/config", (c) => {
  return c.json({ mapsApiKey: c.env.GOOGLE_MAPS_API_KEY });
});

app.route("/api/features", features);
app.route("/api/plates", plates);
app.route("/api/search", search);

export default {
  fetch: app.fetch,
};
