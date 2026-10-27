import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/index.js";
import type { DriveClient } from "../google/drive.js";
import type { SheetsClient } from "../google/sheets.js";
import type { ThumbnailCache } from "../scan/thumbnails.js";
import type { MuseBot } from "../bot/museBot.js";
import type { BatchRunner } from "../queue/runner.js";
import type { KeyStore } from "../keyStore.js";
import type { ServiceAccountCredentials } from "../config.js";
import { APP_VERSION } from "../version.js";
import { registerBatchRoutes } from "./batch.js";
import { registerBatchRunRoutes } from "./batchRun.js";
import { registerBotRoutes } from "./bot.js";
import { registerHistoryRoutes, StatusBanner } from "./history.js";
import { HomePage } from "./home.js";
import { setStatusBanner } from "./layout.js";
import { registerScanRoutes } from "./scan.js";
import { registerSettingsRoutes } from "./settings.js";
import { needsKeySetup, registerSetupRoutes } from "./setup.js";
import { registerSheetRoutes } from "./sheets.js";

export interface AppDeps {
  sheets?: SheetsClient;
  drive?: DriveClient;
  thumbs?: ThumbnailCache;
  bot?: MuseBot;
  runner?: BatchRunner;
  keyStore?: KeyStore;
  verifyKey?: (credentials: ServiceAccountCredentials) => Promise<void>;
  restart?: () => void;
  chromeInstalled?: () => boolean | undefined;
}

export function createApp(config: AppConfig, db: DB, deps: AppDeps = {}) {
  const app = new Hono();
  setStatusBanner(() => <StatusBanner db={db} runner={deps.runner} />);

  // Bản zip chưa có khoá Google: mọi trang dẫn về Cài khoá (D15).
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && needsKeySetup(config) && !c.req.path.startsWith("/setup") && c.req.path !== "/health") {
      return c.redirect("/setup", 302);
    }
    await next();
  });

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
  registerBotRoutes(app, {
    config,
    db,
    bot: deps.bot,
    runner: deps.runner,
    screenshotDir: config.screenshotDir,
    chromeInstalled: deps.chromeInstalled,
  });
  registerBatchRunRoutes(app, { db, runner: deps.runner });
  registerHistoryRoutes(app, { db });
  registerSetupRoutes(app, { config, db, keyStore: deps.keyStore, runner: deps.runner, verifyKey: deps.verifyKey, restart: deps.restart });

  app.get("/health", (c) => c.json({ ok: true, app: "masys-video", version: APP_VERSION, serviceAccount: config.serviceAccount.ok }));

  return app;
}
