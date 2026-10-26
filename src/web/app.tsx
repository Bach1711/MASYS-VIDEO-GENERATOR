import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import type { SheetsClient } from "../google/sheets.js";
import { HomePage } from "./home.js";
import { registerSheetRoutes } from "./sheets.js";

export function createApp(config: AppConfig, db: DB, deps: { sheets?: SheetsClient } = {}) {
  const app = new Hono();

  app.get("/", (c) => {
    const { dailyVideoLimit } = db.prepare("SELECT dailyVideoLimit FROM settings WHERE id = 1").get() as {
      dailyVideoLimit: number;
    };
    return c.html(
      "<!doctype html>" + <HomePage serviceAccount={config.serviceAccount} dailyVideoLimit={dailyVideoLimit} />,
    );
  });

  registerSheetRoutes(app, { config, db, sheets: deps.sheets });

  app.get("/health", (c) => c.json({ ok: true, serviceAccount: config.serviceAccount.ok }));

  return app;
}
