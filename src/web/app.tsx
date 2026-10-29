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
import { registerBangMoiRoutes } from "./bangMoi.js";
import { registerBatchRoutes } from "./batch.js";
import { registerBatchRunRoutes } from "./batchRun.js";
import { registerBotRoutes } from "./bot.js";
import { registerHistoryRoutes, StatusBanner } from "./history.js";
import { registerGuideRoutes } from "./guide.js";
import { registerStartRoutes } from "./start.js";
import { registerLogoRoutes } from "./logo.js";
import { setStatusBanner, setUpdateBanner } from "./layout.js";
import { registerScanRoutes } from "./scan.js";
import { registerSettingsRoutes } from "./settings.js";
import { needsKeySetup, registerSetupRoutes } from "./setup.js";
import { registerUpdateRoutes, UpdateBanner } from "./update.js";
import type { Updater } from "../update/updater.js";
import { registerSheetRoutes } from "./sheets.js";
import { registerTableRoutes } from "./table.js";

/** Trang chỉ dùng được khi có khoá Google (Bảng theo sheet, kết nối sheet, quét, nhập từ sheet). */
const SHEET_PAGES = ["/bang-sheet", "/bat-dau/sheet", "/sheets", "/ket-noi", "/scan", "/bang", "/bang-moi/nhap"];

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
  updater?: Updater;
}

export function createApp(config: AppConfig, db: DB, deps: AppDeps = {}) {
  const app = new Hono();
  setStatusBanner(() => <StatusBanner db={db} runner={deps.runner} />);
  setUpdateBanner(() => <UpdateBanner updater={deps.updater} />);

  // Chưa có khoá Google: chỉ các trang cần Google Sheet / Drive dẫn về Cài khoá (D15). Từ v2.0.0 Bảng mới và bot
  // chạy không cần khoá (spec v6.0 mục 17.8).
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && needsKeySetup(config) && SHEET_PAGES.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
      return c.redirect("/setup", 302);
    }
    await next();
  });
  registerLogoRoutes(app);

  // Bảng theo sheet chưa kết nối sheet nào: hiện 4 bước của Bảng theo sheet (CON-51).
  const { startPage } = registerStartRoutes(app, { config, db, ...deps });
  registerTableRoutes(app, { config, db, ...deps }, startPage);
  registerGuideRoutes(app);
  registerBangMoiRoutes(app, { config, db, ...deps });

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
  registerUpdateRoutes(app, { updater: deps.updater });
  registerSetupRoutes(app, { config, db, keyStore: deps.keyStore, runner: deps.runner, verifyKey: deps.verifyKey, restart: deps.restart });

  app.get("/health", (c) => c.json({ ok: true, app: "masys-video", version: APP_VERSION, serviceAccount: config.serviceAccount.ok }));

  return app;
}
