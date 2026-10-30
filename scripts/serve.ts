import express from "express";
import { rateLimit } from "express-rate-limit";
import { createRequestHandler } from "@react-router/express";
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY)
  app.set("trust proxy", process.env.TRUST_PROXY.split(","));
app.use((request, response, next) => {
  request.headers["x-wavecase-ip"] =
    request.ip || request.socket.remoteAddress || "";
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cache-Control", "private, no-store");
  next();
});
app.use(
  "/auth",
  rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(
  ["/feedback", "/events", "/visits"],
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (request) => request.method === "GET",
  }),
);
app.use(
  "/assets",
  express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
);
app.use(express.static("build/client", { maxAge: 0 }));
const buildPath = "../build/server/index.js";
app.use(
  createRequestHandler({
    build: () => import(buildPath),
    mode: process.env.NODE_ENV,
  }),
);
app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Wavecase listening on port " + (process.env.PORT || 3000)),
);
