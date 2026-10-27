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

const config = loadConfig();

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

const app = createApp(config, db, { sheets, drive, thumbs, bot, runner });
const server = serve({ fetch: app.fetch, hostname: HOST, port: config.port }, (info) => {
  logger.info(`Tool đang chạy tại http://localhost:${info.port}`);
});

async function shutdown() {
  server.close();
  await bot.close().catch(() => {});
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
