import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import { HomePage } from "./home.js";

export function createApp(config: AppConfig, db: DB) {
  const app = new Hono();

  app.get("/", (c) => {
    const { dailyVideoLimit } = db.prepare("SELECT dailyVideoLimit FROM settings WHERE id = 1").get() as {
      dailyVideoLimit: number;
    };
    return c.html(
      "<!doctype html>" + <HomePage serviceAccount={config.serviceAccount} dailyVideoLimit={dailyVideoLimit} />,
    );
  });

  app.get("/health", (c) => c.json({ ok: true, serviceAccount: config.serviceAccount.ok }));

  return app;
}
