import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import type { DriveClient } from "../google/drive.js";
import type { SheetsClient } from "../google/sheets.js";
import type { ThumbnailCache } from "../scan/thumbnails.js";
import type { MuseBot } from "../bot/museBot.js";
import { registerBatchRoutes } from "./batch.js";
import { registerBotRoutes } from "./bot.js";
import { HomePage } from "./home.js";
import { registerScanRoutes } from "./scan.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerSheetRoutes } from "./sheets.js";

export interface AppDeps {
  sheets?: SheetsClient;
  drive?: DriveClient;
  thumbs?: ThumbnailCache;
  bot?: MuseBot;
}

export function createApp(config: AppConfig, db: DB, deps: AppDeps = {}) {
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
  registerScanRoutes(app, { config, db, ...deps });
  registerBatchRoutes(app, { config, db, ...deps });
  registerSettingsRoutes(app, { config, db, ...deps });
  registerBotRoutes(app, { config, db, bot: deps.bot, screenshotDir: config.screenshotDir });

  app.get("/health", (c) => c.json({ ok: true, serviceAccount: config.serviceAccount.ok }));

  return app;
}
