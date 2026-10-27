import { serve } from "@hono/node-server";
import { MuseBot } from "./bot/museBot.js";
import { DEFAULT_MUSE_URL } from "./bot/museSelectors.js";
import { getSettings } from "./db/settings.js";
import { BatchRunner } from "./queue/runner.js";
import { HOST, loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { serviceAccountTokenProvider } from "./google/auth.js";
import { DriveClient } from "./google/drive.js";
import { createGoogleHttp } from "./google/http.js";
import { SheetsClient } from "./google/sheets.js";
import { logger } from "./logger.js";
import { ThumbnailCache } from "./scan/thumbnails.js";
import { createApp } from "./web/app.js";
import { applyStoredKey, KeyStore } from "./keyStore.js";
import { APP_VERSION } from "./version.js";
import { isChromeInstalled } from "./bot/chrome.js";
import { RESTART_EXIT_CODE } from "./restart.js";

const config = loadConfig();
const keyStore = new KeyStore(config.dataDir);
await applyStoredKey(config, keyStore);
logger.info({ version: APP_VERSION, keySource: config.keySource }, "Khởi động MASYS Video");

if (config.serviceAccount.ok) {
  logger.info({ clientEmail: config.serviceAccount.clientEmail }, "Đã nạp khoá service account");
} else {
  // Không crash: tool vẫn mở được giao diện để hiện hướng dẫn.
  logger.warn(config.serviceAccount.problem);
}

const db = openDatabase(config.dbPath);
logger.info({ dataDir: config.dataDir }, "Đã mở cơ sở dữ liệu");

const google = config.serviceAccount.ok
  ? createGoogleHttp(serviceAccountTokenProvider(config.serviceAccount.credentials))
  : undefined;
const sheets = google && new SheetsClient(google);
const drive = google && new DriveClient(google);
const thumbs = drive && new ThumbnailCache(drive);

const bot = new MuseBot({
  profileDir: config.botProfileDir,
  screenshotDir: config.screenshotDir,
  museUrl: () => getSettings(db).museUrl ?? DEFAULT_MUSE_URL,
});

// Hàng đợi chạy lô (CON-40). Lô đang chạy dở khi tool tắt: theo dõi nốt dòng đã gửi, không gửi lại.
const runner = sheets && drive && new BatchRunner(db, sheets, drive, bot);
runner?.recover();

const app = createApp(config, db, {
  sheets,
  drive,
  thumbs,
  bot,
  runner,
  keyStore,
  chromeInstalled: () => isChromeInstalled(),
  verifyKey: async (credentials) => {
    await serviceAccountTokenProvider(credentials)();
  },
  // Chỉ tự bật lại được khi chạy qua launcher (bản zip); chạy npm run dev thì người dùng tự chạy lại.
  restart: process.env.MASYS_LAUNCHER === "1" ? () => setTimeout(() => void shutdown(RESTART_EXIT_CODE), 500) : undefined,
});
const server = serve({ fetch: app.fetch, hostname: HOST, port: config.port }, (info) => {
  logger.info(`Tool đang chạy tại http://localhost:${info.port}`);
});

async function shutdown(code = 0) {
  server.close();
  await bot.close().catch(() => {});
  db.close();
  process.exit(code);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
